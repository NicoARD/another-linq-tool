# Another LINQ Tool

Another LINQ Tool is a VS Code extension and .NET runner for executing C# LINQ scripts. Open a `.linq` or `.csx` file, run it with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, and inspect the final value (and any `Dump()` calls) in VS Code.

The packaged extension includes self-contained runners for supported Windows, Linux, and macOS systems, so extension users do not need to install .NET.

It supports ordinary C# scripts, external assemblies and imports, NuGet packages, and opt-in EF Core `DbContext` profiles.

## Quick start

You need:

- .NET SDK 9.0 or newer
- Node.js 20 or newer
- Visual Studio Code 1.85 or newer

From this directory, build a release-candidate VSIX:

```powershell
cd extension
npm install
npm run release:check
```

`release:check` publishes the .NET runner into the extension, compiles TypeScript, and creates a `.vsix` package. Install that VSIX in a clean VS Code profile to validate the release artifact. For local development, open the `extension` folder in VS Code and press <kbd>F5</kbd>. In the Extension Development Host window, open a script in `../examples`, then press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or run **Another LINQ Tool: Run Current File**.

The complete extension setup, usage, profiles, and settings guide is in [extension/README.md](extension/README.md).

## Repository layout

```text
runner/LinqRunner/  .NET 11 runner: Roslyn execution and JSON-RPC server
extension/          VS Code extension: UI, profiles, and result display
fixtures/TestModel/ Example model assembly used by the sample profiles
examples/           Sample C# query scripts
```

The extension starts the runner and communicates with it through JSON-RPC over standard input/output. Script execution happens in the runner process.

## Running without VS Code

Run a script directly through the runner:

```powershell
dotnet run --project runner/LinqRunner -- execute examples/hello.linq
```

The runner writes the serialized result to standard output. This is useful for checking runner behavior independently of VS Code.

## Samples

- `examples/hello.linq` — basic LINQ query
- `examples/dump.linq` — inline `Dump()` output
- `examples/using-dll.linq` — types from an external assembly
- `examples/db-query.linq` — EF Core profile and SQLite database

To use the assembly or database samples, first build the fixture:

```powershell
dotnet build fixtures/TestModel
```

Then create the equivalent profile through **Another LINQ Tool: Configure Profiles**. `linqrunner.json` remains only as a legacy import format; its profiles are migrated to VS Code user settings on first activation.

## Security

Scripts are arbitrary C# code and run with your user permissions. Only run scripts and load assemblies or packages you trust. Connection strings entered through the profile editor are stored in VS Code Secret Storage, not in the settings JSON.

## License

This project is licensed under [CC BY-NC 4.0](LICENSE). You may use, copy, modify, and fork it for non-commercial purposes, with attribution. Commercial use, sale, and monetization are not permitted.
