# Another LINQ Tool

Run and debug C# queries against your own code, packages, and EF Core models without creating a console application. Another LINQ Tool combines a VS Code extension with a standalone .NET runner, supporting both individual scripts and notebook-style script collections.

| Workflow | File Types | Best For |
| --- | --- | --- |
| Single script | `.linq`, `.csx` | A quick query, experiment, or reusable script |
| Script collection | `.linqc`, `.csxc` | Independent queries with shared setup and saved results |

Press <kbd>Shift</kbd>+<kbd>Enter</kbd> to run a script or the focused collection block. Set breakpoints and press <kbd>F5</kbd> to debug. Final expressions and `Dump()` calls render as inspectable values, objects, and tables.

**Using the extension?** Start with the [user guide](extension/README.md). The build and development instructions below are for working on this repository.

The packaged extension includes one portable roll-forward runner. It reuses a compatible installed runtime or acquires one through Microsoft's .NET Install Tool, so extension users do not need to install .NET manually or wait for a runner rebuild when a newer runtime is selected.

It supports ordinary C# scripts, LINQPad-style Expression, Statements, and Program queries, external assemblies and imports, NuGet packages, and opt-in EF Core `DbContext` profiles.

Create a `.linq` script or `.linqc` collection from VS Code's **New File** picker, the Command Palette, or Explorer context menu. Both open untitled, so you can start editing without saving first. The Explorer command uses the selected folder and avoids existing filenames.

Editor autocomplete uses the active script profile, including its prelude, imports, referenced DLLs, NuGet packages, and typed `DbContext`. Profile and namespace metadata can also be completed in native directives and LINQPad query headers.

LINQPad `Expression` and `Statements` query kinds are interchangeable in Another LINQ Tool. Both are executed dynamically: statements run normally, and a final expression without a semicolon is automatically displayed.

Result values and `Dump()` output retain nested objects and collections. Expand their disclosure arrows in the result panel to navigate into lists and properties.

## Script Collections

Collections are native VS Code notebooks backed by XML, with three parts:

1. **Namespaces:** an editable directive block with profile-aware completion, initially containing `@namespace System.Text`.
2. **Shared prelude:** variables and setup rerun before each script block.
3. **Script blocks:** independently executable C# snippets with Run, Debug, Clear Results, and Collapse/Expand controls.

Select the profile in the notebook toolbar. Every block runs with that profile, the collection namespaces, and both preludes, using a fresh script submission and optional DbContext. Sibling blocks do not share variables or execution state.

Results appear beneath each block by default, including nested values, console output, diagnostics, and SQL. The toolbar can redirect presentation to the existing results panel. Latest results persist inside the XML on save; clear them before sharing sensitive data. Use **XML** / **Collection UI** to switch editors, with Save/Cancel protection for pending edits.

See the [collection walkthrough](extension/README.md#script-collections) for an example.

## Build From Source

You need:

- .NET 8 SDK or newer
- Node.js 20 or newer
- Visual Studio Code 1.85 or newer

From this directory, build a release-candidate VSIX:

```powershell
cd extension
npm install
npm test
npm run release:check
```

On Windows, run `build.bat` from the repository root to publish the portable runner and compile the extension without creating a VSIX. Run `release-vsix.bat` to build, create the versioned VSIX in the `extension` directory, and verify its runner payload. Install the extension dependencies first with `npm install` in the `extension` directory.

`release:check` publishes the .NET runner into the extension, compiles TypeScript, and creates a `.vsix` package. Install that VSIX in a clean VS Code profile to validate the release artifact. For local development, open the `extension` folder in VS Code and press <kbd>F5</kbd>. In the Extension Development Host window, open a script in `../examples`, then press <kbd>Shift</kbd>+<kbd>Enter</kbd> or run **Another LINQ Tool: Run Current File**.

The complete extension setup, usage, profiles, and settings guide is in [extension/README.md](extension/README.md).

## Development And Validation

Run these commands from the `extension` directory:

| Command | Checks |
| --- | --- |
| `npm run compile` | TypeScript compilation |
| `npm test` | Compilation and collection XML round-trip/validation tests |
| `npm run build:runner` | Publishes the bundled portable .NET runner |
| `npm run test:integration` | Native VS Code notebook and debugger integration |
| `npm run release:check` | Runner publish, extension compilation, VSIX packaging, and payload validation |

Build the runner before running integration tests. The test launcher uses an isolated VS Code profile and the locally installed Microsoft C# and .NET Install Tool extensions. It downloads a test copy of VS Code unless `VSCODE_EXECUTABLE` points to an installed executable:

```powershell
npm run build:runner
$env:VSCODE_EXECUTABLE = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
npm run test:integration
```

Integration checks cover untitled collection creation, both collection extensions, namespace and code completion, independent execution, saved/cleared outputs, XML/UI switching, setup-cell ordering, ordinary-script execution, and notebook breakpoints with stepping and local inspection.

CI runs `npm test` and `npm run release:check` on Windows. The interactive integration suite is a separate local check and requires a desktop environment.

## Repository layout

```text
runner/LinqRunner/  Portable roll-forward runner: Roslyn execution and JSON-RPC server
extension/          VS Code extension: editor integration, notebooks, profiles, and results
extension/scripts/  Build, format tests, native integration tests, and package checks
fixtures/TestModel/ Example model assembly used by the sample profiles
examples/           Sample C# query scripts
```

The extension starts the runner and communicates with it through JSON-RPC over standard input/output. Script execution happens in the runner process.

The runner owns Roslyn compilation, dependency loading, DbContext construction, SQL capture, and bounded result serialization. The extension owns profiles, runtime selection, notebook persistence, source mapping, and presentation. Application assemblies are reused within the runner; dependency changes trigger process replacement rather than in-process unloading.

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

Scripts are arbitrary C# code and run with your user permissions; the runner is not a sandbox. Only run scripts and load assemblies or packages you trust. Connection strings entered through the profile editor are stored in VS Code Secret Storage, not in the settings JSON.

Collections persist result values, console output, SQL, and parameters. Use **Clear All Results**, then save, before sharing files that may contain sensitive data. Profile exports can also contain connection strings.

Runtime acquisition does not install an SDK. Profiles that restore NuGet packages need a .NET SDK capable of targeting the selected execution runtime.

## License

This project is licensed under the [PolyForm Internal Use License 1.0.0](LICENSE).
