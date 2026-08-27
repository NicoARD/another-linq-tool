# Another LINQ Tool

Another LINQ Tool is a VS Code extension and .NET runner for executing C# LINQ scripts. Open a `.linq` or `.csx` file, run it with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, and inspect the final value (and any `Dump()` calls) in VS Code.

The packaged extension includes portable .NET 10 and .NET 11 runners. It reuses a compatible installed runtime or acquires one through Microsoft's .NET Install Tool, so extension users do not need to install .NET manually.

It supports ordinary C# scripts, LINQPad-style Expression, Statements, and Program queries, external assemblies and imports, NuGet packages, and opt-in EF Core `DbContext` profiles.

Editor autocomplete uses the active script profile, including its prelude, imports, referenced DLLs, NuGet packages, and typed `DbContext`. Profile and namespace metadata can also be completed in native directives and LINQPad query headers.

LINQPad `Expression` and `Statements` query kinds are interchangeable in Another LINQ Tool. Both are executed dynamically: statements run normally, and a final expression without a semicolon is automatically displayed.

Result values and `Dump()` output retain nested objects and collections. Expand their disclosure arrows in the result panel to navigate into lists and properties.

## Quick start

You need:

- .NET 11 SDK (currently a preview; it builds both runner targets)
- Node.js 20 or newer
- Visual Studio Code 1.85 or newer

From this directory, build a release-candidate VSIX:

```powershell
cd extension
npm install
npm run release:check
```

On Windows, run `build.bat` from the repository root to publish the portable .NET 10 and .NET 11 runners and compile the extension without creating a VSIX. Run `release-vsix.bat` to build, create the versioned VSIX in the `extension` directory, and verify its runner payload. Install the extension dependencies first with `npm install` in the `extension` directory.

`release:check` publishes the .NET runner into the extension, compiles TypeScript, and creates a `.vsix` package. Install that VSIX in a clean VS Code profile to validate the release artifact. For local development, open the `extension` folder in VS Code and press <kbd>F5</kbd>. In the Extension Development Host window, open a script in `../examples`, then press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or run **Another LINQ Tool: Run Current File**.

The complete extension setup, usage, profiles, and settings guide is in [extension/README.md](extension/README.md).

## Repository layout

```text
runner/LinqRunner/  .NET 10/11 runner: Roslyn execution and JSON-RPC server
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
- `examples/linqpad-expression.linq` — LINQPad Expression query header
- `examples/linqpad-statements.linq` — LINQPad Statements query with a final value
- `examples/linqpad-program.linq` — LINQPad Program query with async `Main`
- `examples/program-directives.linq` — `@kind` and `@namespace` Program query
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
