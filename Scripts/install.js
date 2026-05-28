//
// install.js — locate or auto-install the clojure-lsp binary.
//
// Resolution order:
//   1. The `clojureLsp.path` setting (workspace overrides global).
//   2. A binary previously downloaded into the extension's global storage.
//   3. `clojure-lsp` on the user's login-shell PATH.
//   4. A set of well-known install locations.
//   5. (auto mode) Download and install the official native release.
//

const KNOWN_PATHS = [
    "/opt/homebrew/bin/clojure-lsp",
    "/usr/local/bin/clojure-lsp",
    "/usr/bin/clojure-lsp",
];

const RELEASE_BASE =
    "https://github.com/clojure-lsp/clojure-lsp/releases/latest/download";

function binDir() {
    return nova.path.join(nova.extension.globalStoragePath, "bin");
}

function storedBinaryPath() {
    return nova.path.join(binDir(), "clojure-lsp");
}

// Read a config key, letting the workspace value override the global one.
function configPath() {
    const workspaceValue = nova.workspace.config.get("clojureLsp.path", "string");
    if (workspaceValue && workspaceValue.trim()) {
        return workspaceValue.trim();
    }
    const globalValue = nova.config.get("clojureLsp.path", "string");
    if (globalValue && globalValue.trim()) {
        return globalValue.trim();
    }
    return null;
}

function isExecutable(path) {
    try {
        return !!path && nova.fs.access(path, nova.fs.F_OK, nova.fs.X_OK);
    } catch (_err) {
        return false;
    }
}

// Run a command to completion, capturing stdout/stderr.
function run(command, args, options = {}) {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let process;
        try {
            process = new Process(command, Object.assign({ args }, options));
        } catch (err) {
            resolve({ status: -1, stdout: "", stderr: String(err) });
            return;
        }
        process.onStdout((line) => { stdout += line; });
        process.onStderr((line) => { stderr += line; });
        process.onDidExit((status) => resolve({ status, stdout, stderr }));
        try {
            process.start();
        } catch (err) {
            resolve({ status: -1, stdout: "", stderr: String(err) });
        }
    });
}

// Nova's extension host does not inherit the user's interactive PATH (so
// Homebrew's /opt/homebrew/bin is invisible). Ask a login shell to resolve it.
async function lookupOnPath() {
    const result = await run("/bin/bash", ["-l", "-c", "command -v clojure-lsp"]);
    if (result.status === 0) {
        const found = result.stdout.trim().split("\n")[0];
        if (isExecutable(found)) {
            return found;
        }
    }
    return null;
}

function notify(id, title, body, actions) {
    const request = new NotificationRequest(id);
    request.title = title;
    request.body = body;
    if (actions) {
        request.actions = actions;
    }
    return nova.notifications.add(request);
}

function detectArch() {
    return run("/usr/bin/uname", ["-m"]).then((result) => {
        const machine = (result.stdout || "").trim();
        // clojure-lsp publishes macOS builds for amd64 and aarch64.
        return machine === "arm64" || machine === "aarch64" ? "aarch64" : "amd64";
    });
}

async function downloadAndInstall() {
    const arch = await detectArch();
    const assetUrl = `${RELEASE_BASE}/clojure-lsp-native-macos-${arch}.zip`;
    const dir = binDir();
    const zipPath = nova.path.join(dir, "clojure-lsp.zip");

    try {
        nova.fs.mkdir(dir);
    } catch (_err) {
        // Already exists, or globalStoragePath is missing — surfaced below.
    }

    console.log(`[clojure-lsp] downloading ${assetUrl}`);
    const download = await run("/usr/bin/curl", [
        "--fail", "--location", "--silent", "--show-error",
        "--output", zipPath, assetUrl,
    ]);
    if (download.status !== 0) {
        throw new Error(`download failed: ${download.stderr || download.status}`);
    }

    const unzip = await run("/usr/bin/unzip", ["-o", zipPath, "-d", dir]);
    if (unzip.status !== 0) {
        throw new Error(`unzip failed: ${unzip.stderr || unzip.status}`);
    }

    try { nova.fs.remove(zipPath); } catch (_err) { /* best effort */ }

    const binary = storedBinaryPath();
    await run("/bin/chmod", ["+x", binary]);
    if (!isExecutable(binary)) {
        throw new Error("downloaded binary is not executable");
    }
    return binary;
}

//
// Resolve a usable clojure-lsp path, auto-installing if necessary.
// Returns the path string, or null if it could not be obtained.
//
async function ensureServerPath() {
    const configured = configPath();
    if (configured) {
        if (isExecutable(configured)) {
            return configured;
        }
        notify(
            "clojure-lsp-bad-path",
            "clojure-lsp not found",
            `The configured path "${configured}" is not an executable file. ` +
            `Falling back to PATH lookup or download.`
        );
    }

    if (isExecutable(storedBinaryPath())) {
        return storedBinaryPath();
    }

    const onPath = await lookupOnPath();
    if (onPath) {
        return onPath;
    }

    for (const candidate of KNOWN_PATHS) {
        if (isExecutable(candidate)) {
            return candidate;
        }
    }

    // Auto mode: nothing found, install the official native release.
    notify(
        "clojure-lsp-downloading",
        "Installing clojure-lsp…",
        "clojure-lsp was not found on your system, so it is being downloaded."
    );
    try {
        const installed = await downloadAndInstall();
        notify(
            "clojure-lsp-installed",
            "clojure-lsp installed",
            "The clojure-lsp language server was downloaded and is ready to use."
        );
        return installed;
    } catch (err) {
        console.error(`[clojure-lsp] auto-install failed: ${err.message}`);
        notify(
            "clojure-lsp-install-failed",
            "Could not install clojure-lsp",
            `${err.message}\n\nInstall it manually (e.g. "brew install ` +
            `clojure-lsp/brew/clojure-lsp-native") and set its path in settings.`,
            ["Open Settings"]
        ).then((reply) => {
            if (reply && reply.actionIdx === 0) {
                nova.openConfig();
            }
        }).catch(() => { /* notification dismissed */ });
        return null;
    }
}

exports.ensureServerPath = ensureServerPath;
exports.storedBinaryPath = storedBinaryPath;
