//
// client.js — manages the clojure-lsp LanguageClient lifecycle.
//

const { ensureServerPath } = require("./install.js");

// Convert a character offset into an LSP { line, character } position.
function lspPosition(editor, offset) {
    const text = editor.getTextInRange(new Range(0, offset));
    let line = 0;
    let lastNewline = -1;
    for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === "\n") {
            line += 1;
            lastNewline = i;
        }
    }
    return { line: line, character: offset - (lastNewline + 1) };
}

// Character offset of the start of each line, indexed by line number.
function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === "\n") {
            starts.push(i + 1);
        }
    }
    return starts;
}

// Convert an LSP { line, character } position into a document character offset,
// clamped to the document. Formatters often express "end of document" as a
// position one line past the last line, so out-of-range lines clamp to the end.
function offsetForPosition(starts, position, docLength) {
    if (position.line >= starts.length) {
        return docLength;
    }
    const offset = starts[position.line] + position.character;
    return offset > docLength ? docLength : offset;
}

// Apply an array of LSP TextEdits to an open editor. Edits are applied from the
// end of the document backwards so earlier offsets aren't invalidated.
function applyTextEdits(editor, edits) {
    if (!edits || edits.length === 0) {
        return Promise.resolve();
    }
    const fullText = editor.getTextInRange(new Range(0, editor.document.length));
    const docLength = fullText.length;
    const starts = lineStarts(fullText);
    const ranges = edits
        .map((edit) => ({
            start: offsetForPosition(starts, edit.range.start, docLength),
            end: offsetForPosition(starts, edit.range.end, docLength),
            newText: edit.newText,
        }))
        .sort((a, b) => b.start - a.start);

    return editor.edit((textEditorEdit) => {
        for (const r of ranges) {
            textEditorEdit.replace(new Range(r.start, r.end), r.newText);
        }
    });
}

// Apply an LSP WorkspaceEdit, which may span multiple files (e.g. rename).
async function applyWorkspaceEdit(workspaceEdit) {
    if (!workspaceEdit) {
        return;
    }
    let changesByUri = {};
    if (Array.isArray(workspaceEdit.documentChanges)) {
        for (const change of workspaceEdit.documentChanges) {
            if (change.textDocument && change.edits) {
                changesByUri[change.textDocument.uri] = change.edits;
            }
        }
    } else if (workspaceEdit.changes) {
        changesByUri = workspaceEdit.changes;
    }

    for (const uri of Object.keys(changesByUri)) {
        const editor = await nova.workspace.openFile(uri);
        if (editor) {
            await applyTextEdits(editor, changesByUri[uri]);
        } else {
            console.error(`[clojure-lsp] could not open ${uri} to apply edits`);
        }
    }
}

class ClojureLanguageServer {
    constructor() {
        this.languageClient = null;
        // Bumped on every stop()/start() so an in-flight start (which may be
        // sleeping between retries) can tell it has been superseded.
        this.generation = 0;
        // Consecutive start/crash failures, for backoff. Reset on a clean start.
        this.crashCount = 0;
    }

    async start() {
        if (this.languageClient) {
            return;
        }

        const generation = ++this.generation;

        const path = await ensureServerPath();
        if (!path) {
            // ensureServerPath() already notified the user.
            return;
        }

        const serverOptions = {
            path: path,
            args: [],
            type: "stdio",
        };

        const clientOptions = {
            syntaxes: ["clojure"],
            initializationOptions: {},
        };

        const trace = nova.config.get("clojureLsp.trace.server", "string");
        if (trace && trace !== "off") {
            clientOptions.initializationOptions.trace = trace;
        }

        // Forward an explicit cljfmt config path to clojure-lsp (workspace
        // overrides global). clojure-lsp reads kebab-case keys here.
        const cljfmtConfigPath = (
            nova.workspace.config.get("clojureLsp.cljfmtConfigPath", "string") ||
            nova.config.get("clojureLsp.cljfmtConfigPath", "string") ||
            ""
        ).trim();
        if (cljfmtConfigPath) {
            clientOptions.initializationOptions["cljfmt-config-path"] =
                cljfmtConfigPath;
        }

        const client = new LanguageClient(
            "com.timetraveltoaster.clojure",
            "Clojure Language Server",
            serverOptions,
            clientOptions
        );

        client.onDidStop((error) => {
            if (error) {
                console.error(`[clojure-lsp] server stopped: ${error}`);
            }
            // Recover from an unexpected exit (a crash), but NOT from an
            // intentional stop()/restart() — those bump the generation, and
            // stop() has already cleared this.languageClient.
            if (this.languageClient === client && generation === this.generation) {
                nova.subscriptions.remove(client);
                this.languageClient = null;
                this.scheduleRecovery(generation, `server exited (${error || "no error"})`);
            }
        });

        // A hot reload runs deactivate() then activate() back-to-back, but
        // LanguageClient.stop() is asynchronous. The previous server (which
        // shares this identifier) may still be shutting down, in which case
        // start() throws "Another instance ... is already running." Retry a
        // few times to let the old instance finish stopping.
        const maxAttempts = 8;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // A stop() or newer start() happened while we were waiting — abandon
            // this attempt so we don't attach an orphaned client.
            if (generation !== this.generation) {
                return;
            }
            try {
                client.start();
                nova.subscriptions.add(client);
                this.languageClient = client;
                this.crashCount = 0;
                console.log(`[clojure-lsp] started using ${path}`);
                return;
            } catch (error) {
                const alreadyRunning = String(error).includes("already running");
                if (alreadyRunning && attempt < maxAttempts) {
                    console.log(
                        `[clojure-lsp] previous server still stopping; ` +
                        `retrying start (attempt ${attempt}/${maxAttempts})`
                    );
                    await new Promise((resolve) => setTimeout(resolve, 700));
                    continue;
                }
                console.error(`[clojure-lsp] failed to start: ${error}`);
                // Don't give up permanently — schedule a backed-off retry.
                this.scheduleRecovery(generation, `failed to start (${error})`);
                return;
            }
        }
    }

    // Schedule a backed-off (re)start after a crash or failed start. Caps
    // consecutive failures so a genuinely broken binary doesn't loop forever;
    // a clean start or a manual restart() resets the count.
    scheduleRecovery(generation, reason) {
        if (generation !== this.generation || this.languageClient) {
            return;
        }
        const maxCrashes = 5;
        if (this.crashCount >= maxCrashes) {
            nova.workspace.showErrorMessage(
                "clojure-lsp keeps failing to start. Run “Restart " +
                "clojure-lsp Server” from the Editor menu to try again."
            );
            return;
        }
        this.crashCount += 1;
        const delay = 1000 * this.crashCount;
        console.log(
            `[clojure-lsp] ${reason}; recovering in ${delay}ms ` +
            `(attempt ${this.crashCount}/${maxCrashes})`
        );
        setTimeout(() => {
            if (generation === this.generation && !this.languageClient) {
                this.start();
            }
        }, delay);
    }

    stop() {
        // Invalidate any in-flight start() that is between retries.
        this.generation += 1;
        if (this.languageClient) {
            this.languageClient.stop();
            nova.subscriptions.remove(this.languageClient);
            this.languageClient = null;
        }
    }

    async restart() {
        this.stop();
        // A manual restart is a fresh start; clear any backoff from prior fails.
        this.crashCount = 0;
        // Give the server process a moment to fully exit before relaunching.
        await new Promise((resolve) => setTimeout(resolve, 700));
        await this.start();
    }

    // Run clojure-lsp's `clean-ns` refactoring on the active editor's namespace.
    async cleanNamespace(editor) {
        if (!this.languageClient) {
            nova.workspace.showErrorMessage(
                "clojure-lsp is not running."
            );
            return;
        }

        const offset = editor.selectedRange.start;
        const position = lspPosition(editor, offset);
        const uri = editor.document.uri;

        try {
            await this.languageClient.sendRequest("workspace/executeCommand", {
                command: "clean-ns",
                arguments: [uri, position.line, position.character],
            });
        } catch (error) {
            console.error(`[clojure-lsp] clean-ns failed: ${error}`);
            nova.workspace.showErrorMessage(`Clean Namespace failed: ${error}`);
        }
    }

    // Format the active document via textDocument/formatting (cljfmt). Nova
    // does not auto-wire LSP formatting, so we request and apply the edits.
    async formatDocument(editor, quiet = false) {
        if (!this.languageClient) {
            if (!quiet) {
                nova.workspace.showErrorMessage("clojure-lsp is not running.");
            }
            return;
        }
        try {
            const edits = await this.languageClient.sendRequest(
                "textDocument/formatting",
                {
                    textDocument: { uri: editor.document.uri },
                    options: {
                        tabSize: editor.tabLength || 2,
                        insertSpaces: editor.softTabs !== false,
                    },
                }
            );
            await applyTextEdits(editor, edits);
        } catch (error) {
            console.error(`[clojure-lsp] formatting failed: ${error}`);
            // On format-on-save we stay quiet rather than popping a modal.
            if (!quiet) {
                nova.workspace.showErrorMessage(`Format Document failed: ${error}`);
            }
        }
    }

    // Rename the symbol at the cursor via textDocument/rename. Nova does not
    // auto-wire rename, so we prompt for the new name and apply the edit.
    rename(editor) {
        if (!this.languageClient) {
            nova.workspace.showErrorMessage("clojure-lsp is not running.");
            return;
        }
        const position = lspPosition(editor, editor.selectedRange.start);
        const uri = editor.document.uri;

        nova.workspace.showInputPanel(
            "Rename symbol to:",
            { placeholder: "new-name" },
            async (newName) => {
                if (!newName) {
                    return;
                }
                try {
                    const workspaceEdit = await this.languageClient.sendRequest(
                        "textDocument/rename",
                        {
                            textDocument: { uri },
                            position: position,
                            newName: newName,
                        }
                    );
                    await applyWorkspaceEdit(workspaceEdit);
                } catch (error) {
                    console.error(`[clojure-lsp] rename failed: ${error}`);
                    nova.workspace.showErrorMessage(`Rename failed: ${error}`);
                }
            }
        );
    }
}

module.exports = { ClojureLanguageServer };
