# Clojure for Nova

Clojure and ClojureScript language support for [Panic Nova](https://nova.app),
powered by [clojure-lsp](https://clojure-lsp.io).

> **Version 2.0** is a complete rewrite. Version 1.x provided simple syntax
> highlighting and jump-to-definition for locally-defined functions; 2.0 keeps
> the bundled syntax and adds the full clojure-lsp language server — completion,
> diagnostics, project-wide navigation, rename, formatting, and refactorings —
> installing clojure-lsp automatically if it isn't already on your system.

## Features

From the **bundled syntax** (works without a language server):

- Syntax highlighting for `.clj`, `.cljs`, `.cljc`, `.cljx`, `.edn`, `.bb`
- Symbol navigation — the Symbols list / jump bar shows your `def`s, `defn`s,
  and namespaces (Nova drives its outline from the syntax, not the LSP)

Automatically from **clojure-lsp** via Nova's language client:

- Autocompletion
- Diagnostics / linting (clj-kondo, built into clojure-lsp)
- Hover documentation
- Go to definition and find references
- Code actions and refactorings
- Signature help

Via **editor commands** this extension adds (Nova doesn't wire these to the LSP
itself — see Commands below): rename and document formatting.

> Note: Nova has no LSP semantic-token support, so highlighting comes from the
> bundled grammar rather than clojure-lsp.

## Requirements

The extension needs the [`clojure-lsp`](https://clojure-lsp.io/installation/)
binary. It is located automatically in this order:

1. The **clojure-lsp executable path** setting, if you set one.
2. A copy previously downloaded by this extension.
3. `clojure-lsp` on your shell `PATH` (e.g. installed via Homebrew).
4. Common install locations (`/opt/homebrew/bin`, `/usr/local/bin`).

If none of those succeed, the extension **automatically downloads** the official
native release for your Mac into its private storage — no setup required.

To install it yourself instead (recommended for control over the version):

```sh
brew install clojure-lsp/brew/clojure-lsp-native
```

## Commands

Available from the **Editor** menu when a Clojure file is focused:

- **Rename Symbol** — rename the symbol at the cursor across the project
  (`textDocument/rename`).
- **Format Document** — format the file with cljfmt (`textDocument/formatting`).
- **Clean Namespace (clojure-lsp)** — run clojure-lsp's `clean-ns`
  refactoring on the current namespace.
- **Restart clojure-lsp Server** — relaunch the language server.

These commands use the bundled language client, so they require the
**Language server management** setting to be **Bundled** (the default).

## Configuration

Both global and per-workspace:

- **Enable clojure-lsp** — turn the server on or off.
- **clojure-lsp executable path** — override binary discovery with an explicit
  path.
- **Server trace** — log LSP traffic to the Extension Console (`off`,
  `messages`, `verbose`).
- **Language server management** — `Bundled` (this extension launches and
  auto-installs clojure-lsp) or `Nova-managed` (defer to Nova 14's built-in
  language server management; install clojure-lsp from Settings → Languages).
- **Format on save** — automatically run Format Document on save (off by
  default).
- **cljfmt config path** — path to a cljfmt config file, forwarded to
  clojure-lsp (`cljfmt-config-path`). Leave blank to use clojure-lsp's own
  config (`.lsp/config.edn`).

## License

MIT. The Clojure logo is a trademark of the Clojure project, used here to
identify the language.
