# Changelog

## 1.0.3

- Added theme-aware C#-style syntax highlighting for `.linq` and `.csx` files by reusing the installed C# TextMate grammar.
- Added highlighting for a first-line `@profile <name>` directive without changing the script source.
- Prevented C# syntax diagnostics from flagging ALT-specific script constructs, including a final expression without a trailing semicolon.
