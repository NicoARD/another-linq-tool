# Changelog

All notable changes to Another LINQ Tool are documented in this file.

## 1.2.0

- Use portable .NET 10 and .NET 11 runners with managed runtime acquisition instead of bundling six self-contained runtimes.
- Default to .NET 10 LTS and automatically select .NET 11 for profiles referencing `net11.0` assemblies.

## 1.0.0

- Initial release of the VS Code extension and self-contained .NET runner.
- Run `.linq` and `.csx` C# LINQ scripts directly from VS Code.
- Support execution profiles for assemblies, imports, NuGet packages, and EF Core contexts.

## 1.0.2

- Bundle the `vscode-jsonrpc` runtime dependency in the packaged extension so commands are available after installing from a VSIX or the Marketplace.
- Run scripts with the selected (active) profile instead of the default profile.
- Support a first-line `@profile <name>` directive to override the profile for a single run.

## 1.0.1

- Explicitly activate the extension when any contributed command is invoked.
- Activate after VS Code startup so contributed commands are always registered.
- Continue activation if legacy profile migration fails.
