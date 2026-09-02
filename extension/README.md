# Another LINQ Tool

**Interactive C# scripting, right inside VS Code.**

Open a file, write plain C#, hit <kbd>Shift</kbd>+<kbd>Enter</kbd>, and see the result instantly — no console project, no boilerplate, no need for `Main()`.

![Another LINQ Tool in action](https://i.imgur.com/QdQChSy.gif)


## Features

- Create and run `.linq` or `.csx` C# scripts instantly.
- Use your own .NET code directly in scripts.
- Connect an EF Core `DbContext` and query it through `Db`.
- Run scripts with **Shift+Enter** or the play button.
- Debug with breakpoints and **F5**, even without saving.
- Create reusable profiles for your code, packages, setup, and databases.
- Get autocomplete for your code, packages, and `DbContext`.
- Inspect results with `Dump()` and expandable objects.
- Use `async`/`await` and async EF Core queries.
- Run LINQPad C# query files with partial compatibility.
- Switch profiles globally or per script.
- Automatically manage .NET runtimes, with **.NET 10 LTS** by default.
---

## Query your real app and database

Group your DLLs, namespaces, NuGet packages, and database connection into a reusable **profile**. Then write queries against your actual application code, no throwaway console app per question.

```csharp
var overdueInvoices = await Db.Invoices
    .Where(invoice => invoice.IsOverdue())   // your own extension method
    .OrderBy(invoice => invoice.DueDate)
    .ToListAsync();

overdueInvoices.Dump();
```

`Db` is your configured EF Core context. `Dump()` displays any value, anywhere — call it as many times as you like.

---

## Just write C# and run it

No ceremony. Write an expression or a few statements, press <kbd>Shift</kbd>+<kbd>Enter</kbd>, and the result appears \u2014 no class, no `Main()`, no project to set up.

```csharp
var names = new[] { "Ada", "Grace", "Linus" };

names.Where(n => n.Length <= 4).OrderBy(n => n)
```

The last expression is shown automatically. Results land in an interactive panel where you can expand nested objects and collections, resize columns, and zoom in.



### Get started in 30 seconds

1. **New File → `.linq` C#/LINQ script** (or run **Another LINQ Tool: Run Current File** from the Command Palette).
2. Write some C#.
3. Press <kbd>Shift</kbd>+<kbd>Enter</kbd>.

That's it. The script runs locally — no save required — and the result appears in the panel. `async`/`await` just works, including async EF Core queries.

> Scripts run as C# with your user permissions. Only run scripts, assemblies, and NuGet packages you trust.

---

<details>
<summary><strong>Working with results</strong></summary>

- The **final expression** is displayed automatically when it has no trailing semicolon.
- `Dump()` displays intermediate or multiple values from anywhere in the script.
- Expand nested objects and collections with the disclosure arrows (or focus one and press <kbd>Enter</kbd>/<kbd>Space</kbd>).
- Hold <kbd>Ctrl</kbd> and scroll to zoom the preview.
- Drag a column header's right edge to resize, use <kbd>Left</kbd>/<kbd>Right</kbd> on the focused handle, or double-click it to restore automatic sizing.

</details>

<details>
<summary><strong>Execution profiles</strong></summary>

Profiles bundle the assemblies, namespaces, NuGet packages, and optional database context your scripts need. They're stored as global VS Code user settings, so they're available in every workspace.

1. Run **Another LINQ Tool: Configure Profiles**.
2. Select **New**, name it, and add assemblies, imports, packages, and an optional setup snippet.
3. For database scripts, enable database support and provide the context type, provider, connection string, and (if needed) factory info.
4. Select **Save**, then make it active from the status bar or via **Another LINQ Tool: Select Profile**.

The editor can import/export JSON profiles. **Run before every script** prepends C# (helpers, variables, setup) to each run in the same script context.

Each profile has a **.NET runtime** selector (**Automatic** uses .NET 10 unless a referenced assembly targets something newer) and an optional **EF Core version** (leave blank to detect the version published beside your app). The runner restarts automatically when the runtime, assemblies, packages, provider, or EF version changes.

Connection strings are stored in VS Code Secret Storage. Exported profiles may contain connection strings — store them securely and never commit them.

</details>

<details>
<summary><strong>Choosing a profile per script</strong></summary>

Each run uses the **active** profile shown in the status bar (or `linqRunner.defaultProfile` if none is selected).

Override it for a single script with a `@profile` directive:

```csharp
@profile testmodel

Db.Customers.Where(customer => customer.IsActive).ToList()
```

It can also be written as a comment, and names with spaces are supported:

```csharp
// @profile MyStagingDB
```

The `@profile` line is stripped before running. If the named profile doesn't exist, the active/default profile is used and a warning is shown.

</details>

<details>
<summary><strong>LINQPad query compatibility</strong></summary>

LINQPad query headers are supported. `Expression` and `Statements` are interchangeable and run the same way — statements run normally, and a final expression without a semicolon is displayed automatically. A `Program` query invokes its parameterless `Main` (including async and value-returning forms).

```csharp
<Query Kind="Program">
  <Namespace>System.Linq</Namespace>
</Query>

async Task<List<int>> Main()
{
    await Task.Delay(10);
    return Enumerable.Range(1, 5).Where(number => number % 2 == 1).ToList();
}
```

Each `<Namespace>` is imported. The native equivalents are `@kind` (or `@query`) and repeatable `@namespace` lines:

```csharp
@kind Program
@namespace System.Linq

void Main()
{
    Enumerable.Range(1, 3).Dump();
}
```

Supported kinds: `Program`, `Expression`, `Statements`. LINQPad profiles and LINQPad-configured database connections are **not** imported.

</details>

<details>
<summary><strong>Commands</strong></summary>

| Command | Description |
| --- | --- |
| **Another LINQ Tool: Run Current File** | Execute the active script. |
| **Another LINQ Tool: Debug Current File** | Attach the .NET debugger and run the active script, including unsaved changes. |
| **Another LINQ Tool: Restart Runner** | Stop and start the local runner process. |
| **Another LINQ Tool: Select Profile** | Change the active execution profile. |
| **Another LINQ Tool: Configure Profiles** | Open the profile editor. |
| **Another LINQ Tool: Open Settings** | Open this extension's VS Code settings. |

</details>

<details>
<summary><strong>Settings</strong></summary>

Open **Another LINQ Tool: Open Settings**, or edit VS Code user settings directly.

| Setting | Default | Purpose |
| --- | --- | --- |
| `linqRunner.dotnetPath` | `dotnet` | Path/command used when a custom `.dll` is selected as the runner. |
| `linqRunner.runnerPath` | empty | Absolute path to a custom runner executable or `.dll`. Empty launches the bundled portable runner. |
| `linqRunner.rowLimit` | `1000` | Maximum number of items shown for sequence results. |
| `linqRunner.profiles` | `{}` | Named profiles. Prefer the profile editor over manual edits. |
| `linqRunner.defaultProfile` | empty | Profile used when no active profile is chosen. |

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

Use absolute assembly paths in global settings. Disabled entries may be written as `{ "path": "C:\\path\\to\\library.dll", "enabled": false }`.

</details>

<details>
<summary><strong>Requirements</strong></summary>

- VS Code 1.85 or newer.

The extension ships one portable roll-forward runner and depends on Microsoft's .NET Install Tool. It reuses an existing compatible runtime when available, otherwise it downloads one for your system — so you don't need to install .NET manually, though the first run may need a network connection.

.NET 10 LTS is used by default. When a profile assembly targets a newer framework, the extension detects it from target-framework metadata and launches the same bundled runner on that compatible runtime.

Assemblies that depend on .NET Framework-only APIs or otherwise incompatible runtimes may not load.

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

- **Runtime acquisition fails:** check the .NET Install Tool output, network/proxy access, or point that tool at an existing compatible .NET install.
- **Runner not found:** reinstall the extension, or set `linqRunner.runnerPath` to an absolute runner executable or DLL path.
- **A custom runner DLL cannot start:** install its required .NET runtime or set `linqRunner.dotnetPath` to the right executable.
- **`Microsoft.Data.SqlClient is not supported on this platform`:** rebuild the referenced project so its `runtimes` directory and `.deps.json` sit beside the assembly, then restart the runner.
- **Missing types or namespaces:** select the correct profile and add the required assembly and import.
- **Missing profile assembly:** build the referenced project and update the path if its output location changed.
- **A NuGet-enabled profile cannot restore:** install an SDK capable of targeting the selected runtime (runtime acquisition installs a runtime, not an SDK).
- **An EF Core profile reports incompatible versions:** leave **EF Core version** on Automatic when the provider is published beside your app, or select the exact EF version used to build the `DbContext`.
- **A script or package fails:** open the **Another LINQ Tool** output channel for runner diagnostics.

</details>

<details>
<summary><strong>License</strong></summary>

Licensed under the [PolyForm Internal Use License 1.0.0](LICENSE).

</details>
