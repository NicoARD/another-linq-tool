# Another LINQ Tool

**Interactive C# scripting, right inside VS Code.**

Write a quick script or organize related queries into a notebook collection. Run with <kbd>Shift</kbd>+<kbd>Enter</kbd>, inspect the results, and debug with <kbd>F5</kbd>, without creating a console project.

![Another LINQ Tool in action](https://i.imgur.com/QdQChSy.gif)


## Get Started

1. Open VS Code's **New File** picker and choose **.linq - C# Script**, **.linqc - Independent Query Collection**, or **.linqnb - Stateful C# Notebook**. All also appear in the Explorer context menu and Command Palette.
2. Start with the example below, or select a profile to use your application assemblies, packages, and database context.
3. Press <kbd>Shift</kbd>+<kbd>Enter</kbd>. A final expression without a semicolon displays its value automatically.

```csharp
Enumerable.Range(1, 10)
  .Where(number => number % 2 == 0)
  .Select(number => new { Number = number, Square = number * number })
```

| Choose | File Types | Experience |
| --- | --- | --- |
| Single script | `.linq`, `.csx` | One script with results in a side panel |
| Collection | `.linqc`, `.csxc` | Notebook cells, shared setup, and results saved with the file |
| Stateful notebook | `.linqnb`, `.csxnb` | Code and Markdown cells sharing variables, imports, and database state |

The extension manages a compatible .NET runtime. Package restoration additionally requires a compatible .NET SDK; see [Requirements](#requirements).

## Features

- Create and run `.linq` or `.csx` C# scripts instantly.
- Use your own .NET code directly in scripts.
- Connect an EF Core `DbContext` and query it through `Db`.
- Organize independent scripts into XML-backed `.linqc` / `.csxc` notebooks with saved results.
- Create reusable profiles for your code, packages, setup, and databases.
- Get autocomplete for your code, packages, and `DbContext`.
- Inspect results with `Dump()` and expandable objects.
- Use `async`/`await` and async EF Core queries.
- Run scripts with **Shift+Enter** or the play button.
- Debug with breakpoints and **F5**, even without saving.
- Run LINQPad C# query files with partial compatibility.
- Switch profiles globally or per script.
- Automatically manage .NET runtimes, with **.NET 10 LTS** by default.
---

## Stateful Notebooks

Available starting in **1.5.1**. For independent queries with shared setup, use the script collections introduced in **1.5.0** instead.

Choose **.linqnb - Stateful C# Notebook** to create a notebook with ordinary C# and Markdown cells.
Save it as `.linqnb` or `.csxnb`. New notebooks start with an editable namespace
block containing `@namespace System.Text`, with namespace-name IntelliSense.
Add one `@namespace` directive per line. Run this block first, or use Run All,
to make its imports available to subsequent cells. There is no prelude.
The namespace block is an ordinary code cell, so it can be moved or edited;
you can also write regular `using` statements in other code cells.

For example, execute this code cell first:

```csharp
using System.Text;
var message = new StringBuilder("Hello");
```

Then execute another code cell:

```csharp
message.Append(" from the next cell").ToString()
```

The second cell uses the same live `message` object. Add Markdown cells for
headings, explanations, and notes through the native notebook controls.

| Control | Behavior |
| --- | --- |
| **Run Cell** / **Shift+Enter** | Execute the focused code cell against current state |
| **Run All Cells** | Execute code cells in document order; skip Markdown and stop on failure |
| **Debug Cell** / **F5** | Debug a code cell in the current session |
| **Restart Kernel** | Clear variables, imports, functions, and database state for this notebook |
| **Restart and Run All** | Start fresh and rebuild state by executing all code cells |
| **Notebook Profile** | Choose a profile and restart its kernel |
| **Clear Cell Results** / **Clear All Notebook Results** | Remove output without clearing variables |
| **XML** / **Notebook UI** | Switch between the XML source and notebook editor |

Each notebook owns an isolated runner. Restarting or cancelling one does
not affect another notebook or an independent collection. A profile's
imports, assemblies, packages, and configured `Db` are available, but its
prelude is not run automatically. Put reusable setup in an ordinary cell.
The configured DbContext stays alive for that notebook session.

**Execution order matters.** Editing or deleting a cell does not reverse
its previous effects. Completion reflects executed submissions, not simply
the cells above the cursor. Compilation errors leave prior state intact;
runtime errors can leave partial mutations. Cancellation resets the kernel,
so use **Restart and Run All** to restore a known state afterward.

Save to persist code, Markdown, execution counts, and the latest outputs.
Live variables and connections are never saved: reopening a closed notebook
starts fresh even when old results are visible. Clear sensitive output and
save before sharing, just as with collections.

Cell debugging supports breakpoints, source navigation, and stepping.
Simple variable-name watches from earlier submissions are supported through
the session bridge; complex debugger expressions involving earlier
submissions may be limited by the .NET debugger's Roslyn script support.

## Script collections

Choose **.linqc** from VS Code's **New File** picker, the Explorer context
menu, or search for **.linqc** in the Command Palette. Like the
`.linq` command, this opens an untitled document without asking you to save
first, using the selected Explorer folder when available. Save it as
`.linqc` or `.csxc`; both formats open as a native VS Code notebook and
store their content as XML.

Use the top toolbar to select a **Profile**, edit collection **Namespaces**,
choose the **Output Location**, or switch to **XML**. The XML editor has a
**Collection UI** button to switch back. Switching a dirty document asks you
to save or cancel; it never silently discards changes.

The first cell is an editable **Namespaces** block with IntelliSense. Add
one directive per line; new collections include this working example:

```csharp
@namespace System.Text
```

For example, scripts can then use `new StringBuilder()` without qualifying
the type name. The **Namespaces** toolbar button focuses this block instead
of opening a comma-separated input. Imports apply to the shared prelude and
every script block.

The second cell is the **shared prelude**. Every script block runs independently
with the profile prelude followed by this shared setup and that block's code.
Variables and database contexts are not shared between blocks. **Run All**
runs each script with its own setup; running the prelude alone checks it.

Use a block's play button or **Shift+Enter** to run it. Set breakpoints in a
block and press **F5**, or use **Debug Block**, to attach the .NET debugger.
Cell completion includes profile references, collection namespaces, and
shared prelude variables.

Use **Collapse Block** / **Expand Block** on the cell toolbar to fold or
reopen a code block. Collapsing code does not clear or rerun its results.

Results default to an expandable area under each block, including nested
values, `Dump()` calls, console output, diagnostics, errors, and SQL. Choose
**Results panel** under **Output Location** for the existing side panel.
The latest results still belong to their blocks in either mode and are
saved inside the XML on normal save. Edited inputs mark retained results
as out of date.

Use **Clear Results** on a block or **Clear All Results** in the toolbar,
then save, to remove persisted output. **Saved values, console output, SQL,
and SQL parameters may contain sensitive data. Clear results before sharing
a collection.** Profile connection strings remain in Secret Storage.

### Collection Walkthrough

Keep the namespace example in the first block:

```csharp
@namespace System.Text
```

Add this setup to the shared prelude:

```csharp
var prefix = "Query";
var numbers = Enumerable.Range(1, 5);
```

In the first script block, inspect a projection:

```csharp
numbers.Select(number => new { Number = number, Square = number * number })
```

Add another script block and run it independently:

```csharp
new StringBuilder(prefix).Append(": ").AppendJoin(", ", numbers).ToString()
```

Either block can run first. The prelude runs again each time; executing one
script does not define variables for another. **Run All** applies this same
independent setup to each script, rather than building a shared session.

### Collection Controls

| Control | Action |
| --- | --- |
| **Profile** | Choose a collection profile, or follow the active profile |
| **Namespaces** | Focus and expand the namespace directive block |
| **Output Location** | Show results inline or in the results panel |
| **Run Block** / **Debug Block** | Execute or debug the selected block |
| **Collapse Block** / **Expand Block** | Fold or reopen code without removing results |
| **Clear Results** / **Clear All Results** | Remove one block's output or all collection output |
| **XML** / **Collection UI** | Switch between source and notebook editing |

Saving persists the latest results, not a run history. Clearing output also
requires a save to remove it from the file on disk. Existing collection
namespace lists are displayed as editable `@namespace` lines automatically.

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

No ceremony. Write an expression or a few statements, press <kbd>Shift</kbd>+<kbd>Enter</kbd>, and the result appears, no `Main()`, no project to set up.

```csharp
var names = new[] { "Ada", "Grace", "Linus" };

names.Where(n => n.Length <= 4).OrderBy(n => n)
```

The last expression is shown automatically. Results land in an interactive panel where you can expand nested objects and collections, resize columns, and zoom in.

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
| **Another LINQ Tool: Configure Global Profiles** | Open the shared profile editor. |
| **.linq** | Create an untitled single script in the selected folder. |
| **.linqc** | Create an untitled notebook collection in the selected folder. |

Search for `.linq` or `.linqc` in the Command Palette to find their creation
commands. Collection-specific actions are listed in [Collection Controls](#collection-controls).

| Shortcut | Single Script | Collection |
| --- | --- | --- |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Run the active script | Run the focused block |
| <kbd>F5</kbd> | Debug the active script | Debug the focused block |
| <kbd>Alt</kbd>+<kbd>X</kbd> | Run the active script | Use the block's Run action |

</details>

<details>
<summary><strong>Settings</strong></summary>

Open VS Code **Settings** and search for `linqRunner`, or edit user settings directly.

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

<a id="requirements"></a>
<details>
<summary><strong>Requirements</strong></summary>

- VS Code 1.85 or newer, with Microsoft's C# extension and .NET Install Tool
  installed as extension dependencies.

The extension ships one portable roll-forward runner and depends on Microsoft's .NET Install Tool. It reuses an existing compatible runtime when available, otherwise it downloads one for your system — so you don't need to install .NET manually, though the first run may need a network connection.

.NET 10 LTS is used by default. When a profile assembly targets a newer framework, the extension detects it from target-framework metadata and launches the same bundled runner on that compatible runtime.

Assemblies that depend on .NET Framework-only APIs or otherwise incompatible runtimes may not load.

**NuGet packages require an SDK.** The runner restores packages by building
a temporary SDK project. Install an SDK capable of targeting your selected
runtime and ensure `dotnet` is available on PATH. Downloading a runtime
through the .NET Install Tool does not satisfy this requirement.

Scripts run with your account's permissions and are not sandboxed. Only
execute trusted code and load trusted assemblies and packages.

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
- **A collection profile was renamed or deleted:** choose an existing profile from the notebook toolbar. A missing explicit collection profile is an error, rather than silently switching database connections.
- **Saved results look different from the current code:** the output is from the last run. An out-of-date indicator marks changed inputs; rerun the block or clear its results.
- **Collection XML will not open:** use **Reopen Editor With...** to select the text editor, repair the reported XML, then switch back to **Collection UI**. Invalid files are not replaced with empty collections.
- **You want to share a collection:** clear its results and save first. Inspect the XML for remaining sensitive source text; clearing output does not remove secrets typed into code.

</details>

## Contributing

Build instructions, repository layout, sample projects, automated tests,
and native notebook/debugger checks are documented in the
[repository README](https://github.com/NicoARD/another-linq-tool#readme).

<details>
<summary><strong>License</strong></summary>

Licensed under the [PolyForm Internal Use License 1.0.0](LICENSE).

</details>
