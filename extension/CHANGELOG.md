# Changelog

All notable changes to Another LINQ Tool are documented in this file.

## 1.5.1

- Add `.linqnb` and `.csxnb` stateful C# notebooks with Markdown cells, per-notebook kernels, shared variables/imports/DbContext, ordered execution, live completion, saved outputs, restart controls, and cell debugging.
- Start new notebooks with an editable `@namespace System.Text` block with namespace-name IntelliSense and two code examples, without a prelude or default Notes Markdown cell.
- Preserve code, Markdown, latest results, and execution counts in XML; reopening keeps saved outputs but starts a fresh kernel. Clearing outputs does not reset live variables.
- Isolate notebook cancellation and restart, stop Run All at the first failure, and fix a runner restart race that could dispose a replacement connection.
- Make New File labels descriptive for single scripts, independent query collections, and stateful notebooks.
- Document stateful notebook execution and debugger limitations, and add format, session lifecycle, cancellation-isolation, and native notebook/debugger regression checks.

## 1.5.0

- Add `.linqc` and `.csxc` script collections: native VS Code notebooks backed by XML, with collection-wide profiles and independently runnable script blocks.
- Add an editable namespaces block with `@namespace` directives, a working example, and profile-aware IntelliSense, plus a shared prelude rerun before each script block.
- Run and debug individual blocks with toolbar actions, Shift+Enter, and F5, including cell breakpoints, stepping, source navigation, and local-variable inspection.
- Display expandable results beneath blocks, including nested values, `Dump()` output, console output, diagnostics, and SQL, with an optional results-panel destination.
- Save the latest results inside collection files, flag results whose inputs have changed, and provide per-block and collection-wide clear actions.
- Add XML/UI switching with unsaved-change protection and Collapse/Expand controls for code blocks.
- Create untitled collections from New File, Explorer, or the Command Palette, with selected-folder support, collision-safe names, and descriptive script/collection entries.
- Expand both usage guides with collection walkthroughs, runtime and SDK requirements, security guidance, and troubleshooting; add collection format tests, native notebook/debugger integration checks, and package validation.

## 1.4.1

- Stop creating auto-generated Markdown instruction files in opened workspaces.

## 1.4.0

- Redesign the profile configuration editor with a pinned profiles bar and General, References & Code, Database, and Advanced tabs.
- Add a guided database connection builder for SQLite, SQL Server, PostgreSQL, and MySQL, with the raw connection string still editable under Advanced.
- Detect `DbContext` types from the configured DLLs and referenced project assemblies in the same output folder, offered as suggestions via a Detect button.
- Add an experimental Advanced option to bypass EF Core global query filters: read queries run as if every query called `IgnoreQueryFilters()`, while writes such as `Add`, `Update`, and `Remove` are unaffected (not available with a custom `DbContext` factory).
- Give GitHub Copilot the `.linq`/`.csx` format and available profiles through auto-applied workspace instructions and a language-model tool.

## 1.2.2

- Run `.linq` and `.csx` scripts with Alt+X as well as Shift+Enter.
- Add a `.linq (C#/LINQ script)` New File entry that opens a runnable untitled script without requiring a save; existing `.csx` files remain supported.
- Add a shared C# Script file icon for `.linq` and `.csx` files.
- Improve cold-start performance by reusing .NET runtime discovery, NuGet outputs, and assembly metadata.

## 1.2.1

- Replace target-specific runner binaries with one .NET 8 roll-forward runner that launches on the runtime selected for the active profile.
- Isolate profile dependency sets by automatically restarting the runner when assemblies, packages, providers, or EF versions change.
- Detect and validate EF Core dependency families, add an optional profile EF version, and restore a missing Microsoft provider at the matching version.
- Add profile-aware C# autocomplete for preludes, imports, referenced DLLs, NuGet packages, and configured `DbContext` types.
- Add completion for `@profile`, `@namespace`, and LINQPad `<Namespace>` metadata, and recognize LINQPad query headers as XML without disrupting C# completion below them.

## 1.2.0

- Replace the six platform-specific self-contained runners with portable .NET 10 and .NET 11 runners, substantially reducing the extension package size.
- Use the Microsoft .NET Install Tool to reuse or acquire the matching runtime; .NET 10 LTS is the default.
- Detect the target framework of configured assemblies and select .NET 11 when a profile references a `net11.0` project.
- Add an Automatic / .NET 10 / .NET 11 runtime selector to the profile editor for explicit per-profile control.
- Restore profile NuGet packages for the selected runner framework. NuGet-enabled profiles still require a compatible SDK because package resolution currently invokes `dotnet build`.

## 1.1.0

- Bundle self-contained .NET 11 runners for Windows, Linux, and macOS on x64 and ARM64, removing the .NET installation requirement for extension users.
- Support LINQPad query headers and per-script namespaces, plus `@kind`, `@query`, and `@namespace` directives. Program queries invoke parameterless sync or async `Main` methods while Expression and Statements queries retain dynamic final-expression behavior.
- Make nested objects and collections in results and `Dump()` output expandable and keyboard-navigable.
- Prefer RID-specific managed package assets when loading user dependencies, preventing unsupported facade assemblies such as the root `Microsoft.Data.SqlClient.dll` from being loaded.
- Add persistent Ctrl+wheel zoom and mouse/keyboard-resizable columns to the result preview.

## 1.0.5

- Added a Cancel button while scripts run, with a forced runner stop fallback for non-cooperative infinite loops.

## 1.0.4

- Capture SQL commands executed by EF Core and show them in collapsed, expandable sections beneath query results and dumps.

## 1.0.3

- Added theme-aware C#-style syntax highlighting for `.linq` and `.csx` files by reusing the installed C# TextMate grammar.
- Added highlighting for a first-line `@profile <name>` directive without changing the script source.
- Prevented C# syntax diagnostics from flagging ALT-specific script constructs, including a final expression without a trailing semicolon.

## 1.0.2

- Bundle the `vscode-jsonrpc` runtime dependency in the packaged extension so commands are available after installing from a VSIX or the Marketplace.
- Run scripts with the selected (active) profile instead of the default profile.
- Support a first-line `@profile <name>` directive to override the profile for a single run.

## 1.0.1

- Explicitly activate the extension when any contributed command is invoked.
- Activate after VS Code startup so contributed commands are always registered.
- Continue activation if legacy profile migration fails.

## 1.0.0

- Initial release of the VS Code extension and self-contained .NET runner.
- Run `.linq` and `.csx` C# LINQ scripts directly from VS Code.
- Support execution profiles for assemblies, imports, NuGet packages, and EF Core contexts.
