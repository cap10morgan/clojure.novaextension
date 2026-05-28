//
// main.js — extension entry point: activation, commands, config observers.
//

const { ClojureLanguageServer } = require("./client.js");

let server = null;

// Resolve the effective enable flag (workspace overrides global).
function isEnabled() {
    const workspaceValue = nova.workspace.config.get("clojureLsp.enable");
    if (workspaceValue === "true" || workspaceValue === true) {
        return true;
    }
    if (workspaceValue === "false" || workspaceValue === false) {
        return false;
    }
    // "null" / unset -> inherit the global setting (default on).
    return nova.config.get("clojureLsp.enable", "boolean") !== false;
}

// How the language server is provided: "bundled" (this extension launches and
// auto-installs clojure-lsp) or "nova" (defer to Nova 14's built-in language
// server management). Workspace overrides global; "inherit" falls through.
function serverMode() {
    const workspaceValue = nova.workspace.config.get("clojureLsp.languageServer");
    if (workspaceValue === "bundled" || workspaceValue === "nova") {
        return workspaceValue;
    }
    const globalValue = nova.config.get("clojureLsp.languageServer", "string");
    return globalValue === "nova" ? "nova" : "bundled";
}

// Whether THIS extension should launch its own clojure-lsp. False when disabled,
// or when deferring to a Nova-managed server on Nova 14+. On older Nova the
// "nova" mode isn't available, so we fall back to the bundled server.
function shouldRunBundledServer() {
    if (!isEnabled()) {
        return false;
    }
    if (serverMode() === "nova") {
        const major = Array.isArray(nova.version) ? nova.version[0] : 0;
        if (major >= 14) {
            console.log(
                "[clojure-lsp] 'Nova-managed' selected; not launching the " +
                "bundled server. Install clojure-lsp via Settings → Languages."
            );
            return false;
        }
        console.warn(
            `[clojure-lsp] 'Nova-managed' language server requires Nova 14+ ` +
            `(running ${nova.versionString}); falling back to the bundled server.`
        );
    }
    return true;
}

// Effective format-on-save flag (workspace overrides global; default off).
function formatOnSaveEnabled() {
    const workspaceValue = nova.workspace.config.get("clojureLsp.formatOnSave");
    if (workspaceValue === "true" || workspaceValue === true) {
        return true;
    }
    if (workspaceValue === "false" || workspaceValue === false) {
        return false;
    }
    return nova.config.get("clojureLsp.formatOnSave", "boolean") === true;
}

function reload() {
    if (!server) {
        return;
    }
    if (shouldRunBundledServer()) {
        server.restart();
    } else {
        server.stop();
    }
}

exports.activate = function () {
    server = new ClojureLanguageServer();

    if (shouldRunBundledServer()) {
        server.start().catch((error) => {
            console.error(`[clojure-lsp] activation error: ${error}`);
        });
    }

    nova.commands.register("clojureLsp.restart", () => {
        if (!server) {
            return;
        }
        if (shouldRunBundledServer()) {
            server.restart();
        } else {
            nova.workspace.showInformativeMessage(
                "clojure-lsp is managed by Nova (Settings → Languages). " +
                "Restart it from there, or switch this extension's " +
                "“Language server management” setting to “Bundled”."
            );
        }
    });

    nova.commands.register("clojureLsp.cleanNamespace", (editor) => {
        if (server) {
            server.cleanNamespace(editor);
        }
    });

    nova.commands.register("clojureLsp.formatDocument", (editor) => {
        if (server) {
            server.formatDocument(editor);
        }
    });

    nova.commands.register("clojureLsp.rename", (editor) => {
        if (server) {
            server.rename(editor);
        }
    });

    // Format on save (opt-in). onWillSave waits for the returned promise and
    // folds the formatting edits into the same save. Stays quiet on failure so
    // saving never pops a modal.
    nova.subscriptions.add(
        nova.workspace.onDidAddTextEditor((editor) => {
            const willSave = editor.onWillSave((textEditor) => {
                if (!server || textEditor.document.syntax !== "clojure") {
                    return;
                }
                if (!formatOnSaveEnabled()) {
                    return;
                }
                return server.formatDocument(textEditor, true);
            });
            nova.subscriptions.add(willSave);
        })
    );

    // Relaunch (or stand down) when any relevant setting changes. cljfmtConfigPath
    // is sent in initializationOptions, so changing it requires a restart.
    nova.config.onDidChange("clojureLsp.enable", reload);
    nova.config.onDidChange("clojureLsp.path", reload);
    nova.config.onDidChange("clojureLsp.trace.server", reload);
    nova.config.onDidChange("clojureLsp.languageServer", reload);
    nova.config.onDidChange("clojureLsp.cljfmtConfigPath", reload);
    nova.workspace.config.onDidChange("clojureLsp.enable", reload);
    nova.workspace.config.onDidChange("clojureLsp.path", reload);
    nova.workspace.config.onDidChange("clojureLsp.languageServer", reload);
    nova.workspace.config.onDidChange("clojureLsp.cljfmtConfigPath", reload);
};

exports.deactivate = function () {
    if (server) {
        server.stop();
        server = null;
    }
};
