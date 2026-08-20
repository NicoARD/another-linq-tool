# Another LINQ Tool

Another LINQ Tool is a VS Code extension and .NET runner for executing C# LINQ scripts. Open a `.linq.csx` or `.csx` file, run it with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, and inspect the final value (and any `Dump()` calls) in VS Code.

It is currently a proof of concept. It supports ordinary C# scripts, external assemblies and imports, NuGet packages, and opt-in EF Core `DbContext` profiles.

## Quick start

You need:

- .NET SDK 9.0 or newer
- Node.js 18 or newer
- Visual Studio Code 1.85 or newer

From this directory, build the runner and extension:

```powershell
dotnet build runner/LinqRunner
cd extension
npm install
npm run compile
```

For local development, open the `extension` folder in VS Code and press <kbd>F5</kbd>. In the Extension Development Host window, open a script in `../examples`, then press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or run **Another LINQ Tool: Run Current File**.

The complete extension setup, usage, profiles, and settings guide is in [extension/README.md](extension/README.md).

## Repository layout

```text
runner/LinqRunner/  .NET 9 runner: Roslyn execution and JSON-RPC server
extension/          VS Code extension: UI, profiles, and result display
fixtures/TestModel/ Example model assembly used by the sample profiles
examples/           Sample C# query scripts
```

The extension starts the runner and communicates with it through JSON-RPC over standard input/output. Script execution happens in the runner process.

## Running without VS Code

Run a script directly through the runner:

```powershell
dotnet run --project runner/LinqRunner -- execute examples/hello.linq.csx
```

The runner writes the serialized result to standard output. This is useful for checking runner behavior independently of VS Code.

## Samples

- `examples/hello.linq.csx` — basic LINQ query
- `examples/dump.linq.csx` — inline `Dump()` output
- `examples/using-dll.linq.csx` — types from an external assembly
- `examples/db-query.linq.csx` — EF Core profile and SQLite database

To use the assembly or database samples, first build the fixture:

```powershell
dotnet build fixtures/TestModel
```

Then create the equivalent profile through **Another LINQ Tool: Configure Profiles**. `linqrunner.json` remains only as a legacy import format; its profiles are migrated to VS Code user settings on first activation.

## Security

Scripts are arbitrary C# code and run with your user permissions. Only run scripts and load assemblies or packages you trust. Connection strings entered through the profile editor are stored in VS Code Secret Storage, not in the settings JSON.

## License

This project is licensed under [CC BY-NC 4.0](LICENSE). You may use, copy, modify, and fork it for non-commercial purposes, with attribution. Commercial use, sale, and monetization are not permitted.
