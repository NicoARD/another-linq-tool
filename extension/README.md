# Another LINQ Tool for VS Code

Run C# LINQ scripts directly from VS Code. The extension sends the active script to a local .NET runner and displays its result in a result panel.

## Requirements

- VS Code 1.85 or newer
- .NET SDK 9.0 or newer
- A built `LinqRunner.dll` (see [Running from source](#running-from-source))

## Running a script

1. Open a `.linq` or `.csx` file in VS Code.
2. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, select the play button in the editor title bar, or run **Another LINQ Tool: Run Current File** from the Command Palette.
3. Review the result panel. The final expression is displayed when it has no trailing semicolon; `Dump()` calls display intermediate values.

For example:

```csharp
var names = new[] { "Ada", "Grace", "Linus" };

names
    .Where(name => name.Length <= 4)
    .OrderBy(name => name)
```

The script is executed as C# code with your user permissions. Treat scripts, referenced assemblies, and NuGet packages as trusted code only.

## Running from source

This repository keeps the extension and runner side by side. From the repository root:

```powershell
dotnet build runner/LinqRunner
cd extension
npm install
npm run compile
```

Open the `extension` folder in VS Code and press <kbd>F5</kbd>. This launches an Extension Development Host. In that window, open one of `../examples/*.linq` and run it.

By default, the development extension looks for the runner at:

```text
../runner/LinqRunner/bin/Debug/net9.0/LinqRunner.dll
```

If your runner is elsewhere, set `anotherLinqTool.runnerPath` as described below.

## Configuration

### Execution profiles

Profiles group the assemblies, namespaces, NuGet packages, and optional database context needed by related scripts. They are global VS Code user settings, so the same profiles are available in every workspace.

1. Run **Another LINQ Tool: Configure Profiles**.
2. Select **New**, give the profile a name, and add its assemblies, imports, and packages.
3. For database scripts, enable database support and supply the context type, provider, connection string, and (when needed) context factory information.
4. Select **Save**. Use the status-bar profile name or **Another LINQ Tool: Select Profile** to make it active.

The profile editor can import and export JSON profile files. Exported files may include connection strings; store them securely and do not commit them.

Connection strings saved through the editor are held in VS Code Secret Storage. Profile names and other non-secret values are stored in the global `linqRunner.*` user settings.

### Settings

Open **Another LINQ Tool: Open Settings** from the Command Palette, or edit VS Code user settings directly.

| Setting | Default | Purpose |
| --- | --- | --- |
| `linqRunner.dotnetPath` | `dotnet` | Path or command used to start the .NET runtime. |
| `linqRunner.runnerPath` | empty | Absolute path to `LinqRunner.dll`. Leave empty for the adjacent development build. |
| `linqRunner.rowLimit` | `1000` | Maximum number of items shown for sequence results. |
| `linqRunner.profiles` | `{}` | Named profiles. Prefer the profile editor over manual changes. |
| `linqRunner.defaultProfile` | empty | Profile selected when no explicit active profile has been chosen. |

Example non-secret profile settings:

```json
{
  "linqRunner.defaultProfile": "testmodel",
  "linqRunner.profiles": {
    "testmodel": {
      "assemblies": [
        "C:\\code\\projects\\TestModel\\bin\\Debug\\net9.0\\TestModel.dll"
      ],
      "imports": ["TestModel"],
      "packages": ["Humanizer"]
    }
  }
}
```

Use absolute assembly paths in global settings. Disabled assembly entries may be represented as `{ "path": "C:\\path\\to\\library.dll", "enabled": false }`.

### Database profiles

When a profile has database support enabled, the configured `DbContext` is supplied to the script as `Db`. A typical script starts with:

```csharp
Db.Customers.Where(customer => customer.IsActive).ToList()
```

Build the assembly containing the context before running. The extension reports missing assembly paths in the **Another LINQ Tool** output channel.

## Commands

| Command | Description |
| --- | --- |
| **Another LINQ Tool: Run Current File** | Execute the active script. |
| **Another LINQ Tool: Restart Runner** | Stop and start the local runner process. |
| **Another LINQ Tool: Select Profile** | Change the active execution profile. |
| **Another LINQ Tool: Configure Profiles** | Open the profile editor. |
| **Another LINQ Tool: Open Settings** | Open this extension's VS Code settings. |

## Troubleshooting

- **Runner not found:** build it with `dotnet build runner/LinqRunner`, or set `linqRunner.runnerPath` to its absolute DLL path.
- **`dotnet` cannot start:** install .NET 9 SDK or set `linqRunner.dotnetPath` to the appropriate executable.
- **Missing types or namespaces:** select the correct profile and add the required assembly and import.
- **Missing profile assembly:** build the referenced project and update the assembly path if its output location changed.
- **A script or package fails:** open the **Another LINQ Tool** output channel for runner diagnostics.

## License

The extension is covered by the repository's [CC BY-NC 4.0 license](../LICENSE): free to use, modify, and fork non-commercially; not permitted for sale or other commercial use.
