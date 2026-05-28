# Changelog

## 2.0.0

A complete rewrite around the [clojure-lsp](https://clojure-lsp.io) language
server. Version 1.x provided only simple syntax highlighting and local
jump-to-definition; 2.0 turns this into a full Clojure/ClojureScript development
extension.

- clojure-lsp integration via Nova's LanguageClient: completion, diagnostics
  (clj-kondo), hover, project-wide go-to-definition, find references, code
  actions, and signature help.
- Rename Symbol and Format Document commands (Nova doesn't auto-wire these to
  the language server, so they're implemented as commands), plus Clean Namespace.
- Automatic clojure-lsp discovery — configured path, PATH, common install
  locations — with automatic download/install of the official native release as
  a fallback.
- Rebuilt Clojure syntax for `.clj`, `.cljs`, `.cljc`, `.cljx`, `.edn`, `.bb`,
  with `def`/`defn`/`ns` symbol navigation (Symbols list / jump bar) and a
  function-call-position highlight heuristic.
- "Restart Server" editor command.
- Global and per-workspace settings for enable, executable path, trace, and
  language-server management (bundled vs. Nova-managed on Nova 14+).
- Resilient server lifecycle: retries through hot-reload races and auto-recovers
  from crashes with backoff.

## 1.0

- Simple Clojure syntax highlighting and jump-to-definition for locally-defined
  functions.
