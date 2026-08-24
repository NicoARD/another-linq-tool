# Changelog

## Unreleased

- Bundle self-contained .NET 11 runners for Windows, Linux, and macOS on x64 and ARM64, removing the .NET installation requirement for extension users.
- Support LINQPad query headers and per-script namespaces, plus `@kind`, `@query`, and `@namespace` directives. Program queries invoke parameterless sync or async `Main` methods while Expression and Statements queries retain dynamic final-expression behavior.

## 1.0.5

- Added a Cancel button while scripts run, with a forced runner stop fallback for non-cooperative infinite loops.

## 1.0.4

- Capture SQL commands executed by EF Core and show them in collapsed, expandable sections beneath query results and dumps.

## 1.0.3

- Added theme-aware C#-style syntax highlighting for `.linq` and `.csx` files by reusing the installed C# TextMate grammar.
- Added highlighting for a first-line `@profile <name>` directive without changing the script source.
- Prevented C# syntax diagnostics from flagging ALT-specific script constructs, including a final expression without a trailing semicolon.
