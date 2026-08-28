# Another LINQ Tool for VS Code

Run C# and LINQ scripts interactively inside VS Code. Open a `.linq` or `.csx` file, write ordinary C#, and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to execute it locally and inspect the result.

The final expression is displayed automatically, and `Dump()` can display intermediate or multiple values. Results appear in an interactive panel where nested objects and collections can be expanded.

![Another LINQ Tool in action](https://i.imgur.com/QdQChSy.gif)

## Use your own code and databases

Another LINQ Tool lets scripts use your existing compiled application code. Add your DLLs to an execution profile, import their namespaces, and use their public types, methods, extension methods, and business logic directly from a script. 

Thanks to .NET's backward compatibility, assemblies targeting compatible earlier versions can generally run when the portable runner is launched on a newer runtime. Assemblies that depend on .NET Framework-only APIs or otherwise incompatible runtimes may not load.

Profiles can also configure an Entity Framework Core `DbContext`. The configured context is made available as `Db`, so scripts can use your application's data model without repeatedly setting up references and database access.

```csharp
var overdueInvoices = await Db.Invoices
    .Where(invoice => invoice.IsOverdue())
    .OrderBy(invoice => invoice.DueDate)
    .ToListAsync();

overdueInvoices.Dump("Overdue invoices");
```

This provides an interactive query window backed by your actual application code, without creating a temporary console project for every query.

## Features

- Run C# scripts (`.linq` and `.csx` files) with <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or the editor play button.
- Reference and use your own compiled .NET assemblies, including compatible earlier versions and newer runtimes detected from assembly metadata.
- Configure an EF Core `DbContext` and access it as `Db`.
- Get profile-aware C# autocomplete from profile preludes, imported namespaces, referenced DLLs, NuGet packages, and the configured `DbContext`.
- Group assemblies, imported namespaces, NuGet packages, setup code, and database configuration into reusable profiles.
- Display a script's final expression automatically and use `Dump()` anywhere in the script.
- Inspect expandable objects, properties, and collections in the result panel.
- Run asynchronous C# and EF Core queries with `async` and `await`.
- Partially run LINQPad query files: C# `Expression`, `Statements`, and `Program` queries are supported, but LINQPad profiles are not imported and database connections configured in LINQPad cannot be used.
- Choose a profile globally or override it for an individual script with `@profile`.
- Use automatically managed .NET runtimes with .NET 10 LTS as the default.

<details>
<summary><strong>Requirements</strong></summary>


- VS Code 1.85 or newer

The extension includes one portable roll-forward runner and depends on Microsoft's .NET Install Tool. It reuses an existing compatible runtime when available and otherwise downloads the runtime for the current system. Users do not need to install .NET manually, but the first run may require a network connection.

.NET 10 LTS is used by default. When a configured profile assembly targets a newer framework, the extension detects its target-framework metadata and launches the same bundled runner on that compatible runtime. A future runtime can therefore be selected without shipping another target-specific runner build.

</details>

<details>
<summary><strong>Running a script</strong></summary>


1. Open a `.linq` or `.csx` file in VS Code.
2. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, select the play button in the editor title bar, or run **Another LINQ Tool: Run Current File** from the Command Palette.
3. Review the result panel. The final expression is displayed when it has no trailing semicolon; `Dump()` calls display intermediate values.

Nested objects and collections in results and `Dump()` output are expandable. Use the disclosure arrows, or focus them and press <kbd>Enter</kbd> or <kbd>Space</kbd>, to navigate into lists and object properties.

In the result preview, hold <kbd>Ctrl</kbd> and scroll to zoom in or out. Drag a column header's right edge to resize it, use <kbd>Left</kbd>/<kbd>Right</kbd> while the resize handle is focused, or double-click the handle to restore automatic sizing.

For example:

```csharp
var names = new[] { "Ada", "Grace", "Linus" };

names
    .Where(name => name.Length <= 4)
    .OrderBy(name => name)
```

Scripts support `async`/`await`, including asynchronous EF Core operations:

```csharp
var activeCustomers = await Db.Customers
    .Where(customer => customer.IsActive)
    .ToListAsync();

activeCustomers.Dump("active customers");
```

The script is executed as C# code with your user permissions. Treat scripts, referenced assemblies, and NuGet packages as trusted code only.

### LINQPad query compatibility

LINQPad query headers are supported. `Expression` and `Statements` are intentionally interchangeable in Another LINQ Tool and use the same dynamic execution as ordinary scripts: statements run normally, and a final expression without a semicolon is automatically displayed. You do not need to change the query kind when switching between those two styles. A `Program` query invokes its parameterless `Main` method, including async and value-returning forms.

```csharp
<Query Kind="Program">
  <Namespace>System</Namespace>
  <Namespace>System.Collections.Generic</Namespace>
  <Namespace>System.Linq</Namespace>
</Query>

async Task<List<int>> Main()
{
    await Task.Delay(10);
    return Enumerable.Range(1, 5).Where(number => number % 2 == 1).ToList();
}
```

Each `<Namespace>` is imported for that script. The equivalent native directives are `@kind` (or `@query`) and repeatable `@namespace` lines:

```csharp
@kind Program
@namespace System.Linq

void Main()
{
    Enumerable.Range(1, 3).Dump();
}
```

Supported kinds are `Program`, `Expression`, and `Statements`. These directives may be combined with `@profile`.

</details>

<details>
<summary><strong>Configuration</strong></summary>


### Execution profiles

Profiles group the assemblies, namespaces, NuGet packages, and optional database context needed by related scripts. They are global VS Code user settings, so the same profiles are available in every workspace.

1. Run **Another LINQ Tool: Configure Profiles**.
2. Select **New**, give the profile a name, and add its assemblies, imports, packages, and optional setup snippet.
3. For database scripts, enable database support and supply the context type, provider, connection string, and (when needed) context factory information.
4. Select **Save**. Use the status-bar profile name or **Another LINQ Tool: Select Profile** to make it active.

The profile editor can import and export JSON profile files. Exported files may include connection strings; store them securely and do not commit them.

Each profile has a **.NET runtime** selector. **Automatic** uses .NET 10 unless a configured assembly targets a newer runtime; choose an explicit runtime for scripts or packages whose requirement is not exposed by a referenced DLL. Selecting a runtime older than a configured assembly produces a compatibility error.

Database profiles also have an optional **EF Core version**. Leave it blank to detect the version published beside the application assembly. Set an exact version such as `8.0.19` when the provider is not part of the application output and must be restored. The extension automatically starts a clean runner when the runtime, assemblies, packages, provider, or EF version changes.

Connection strings saved through the editor are held in VS Code Secret Storage. Profile names and other non-secret values are stored in the global `linqRunner.*` user settings.

### Choosing the profile per script

Each run uses the **active** profile shown in the status bar (change it with **Another LINQ Tool: Select Profile**). If no profile has been selected, the `linqRunner.defaultProfile` is used.

To override the profile for a single script, add a `@profile` directive in its metadata block, naming the profile to use:

```csharp
@profile testmodel

Db.Customers.Where(customer => customer.IsActive).ToList()
```

The directive may also be written as a comment, and profile names with spaces are supported:

```csharp
// @profile MyStagingDB
```

The `@profile` line is stripped before the script runs. If the named profile does not exist, the active profile (or the default) is used instead and a warning is shown.


The **Run before every script** field accepts C# code that is prepended to each script executed with that profile. Use it for helper methods, variables, or one-time setup statements; it runs in the same script context, so declarations are available to the active script.

### Settings

Open **Another LINQ Tool: Open Settings** from the Command Palette, or edit VS Code user settings directly.

| Setting | Default | Purpose |
| --- | --- | --- |
| `linqRunner.dotnetPath` | `dotnet` | Path or command used when a custom `.dll` is selected as the runner. |
| `linqRunner.runnerPath` | empty | Absolute path to a custom runner executable or `.dll`. Leave empty to launch the bundled portable runner on an automatically selected runtime. |
| `linqRunner.rowLimit` | `1000` | Maximum number of items shown for sequence results. |
| `linqRunner.profiles` | `{}` | Named profiles. Prefer the profile editor over manual changes. |
| `linqRunner.defaultProfile` | empty | Profile selected when no explicit active profile has been chosen. |

Example non-secret profile settings:

```json
{
  "linqRunner.defaultProfile": "testmodel",
  "linqRunner.profiles": {
    "testmodel": {
      "targetFramework": "net10.0",
      "efCoreVersion": "9.0.19",
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

</details>

<details>
<summary><strong>Commands</strong></summary>


| Command | Description |
| --- | --- |
| **Another LINQ Tool: Run Current File** | Execute the active script. |
| **Another LINQ Tool: Restart Runner** | Stop and start the local runner process. |
| **Another LINQ Tool: Select Profile** | Change the active execution profile. |
| **Another LINQ Tool: Configure Profiles** | Open the profile editor. |
| **Another LINQ Tool: Open Settings** | Open this extension's VS Code settings. |

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

- **Runtime acquisition fails:** check the .NET Install Tool output, network/proxy access, or configure that tool to use an existing compatible .NET installation.
- **Runner not found:** reinstall the extension, or set `linqRunner.runnerPath` to an absolute runner executable or DLL path.
- **A custom runner DLL cannot start:** install its required .NET runtime or set `linqRunner.dotnetPath` to the appropriate executable.
- **`Microsoft.Data.SqlClient is not supported on this platform`:** rebuild the referenced project so its `runtimes` directory and `.deps.json` are present beside the assembly, then restart the runner. The extension selects the matching RID-specific SqlClient implementation rather than its unsupported root facade.
- **Missing types or namespaces:** select the correct profile and add the required assembly and import.
- **Missing profile assembly:** build the referenced project and update the assembly path if its output location changed.
- **A NuGet-enabled profile cannot restore:** install an SDK capable of targeting the selected execution runtime. Runtime acquisition installs a runtime, not an SDK.
- **An EF Core profile reports incompatible versions:** leave **EF Core version** on Automatic when the provider is published beside the application, or select the exact EF version used to build the `DbContext`. The runner will not combine providers from different EF major versions.
- **A script or package fails:** open the **Another LINQ Tool** output channel for runner diagnostics.

</details>

<details>
<summary><strong>License</strong></summary>


The extension is licensed under the [PolyForm Internal Use License 1.0.0](LICENSE).

</details>
