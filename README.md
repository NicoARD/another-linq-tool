# LINQ Runner — POC

A proof of concept for a **LINQPad-style C# script runner in VS Code**. Open a `.linq.csx`
file, press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, and the whole file is executed as a C# script by a
.NET runner process. The value of the final expression is shown in a result panel.

> Phase‑1 POC scope: **C# script execution only — no database / EF Core yet.** See
> `../docs/architecture.md` for the full product design and later milestones.

## Layout

```
linq-runner-poc/
├── runner/LinqRunner/     # .NET 9 console app: Roslyn scripting + JSON-RPC over stdio
├── extension/             # VS Code extension (TypeScript): commands + result webview
└── examples/              # sample .linq.csx scripts
```

The extension is a thin client; all Roslyn/execution logic lives in the runner. They talk
**JSON-RPC over stdio** (`StreamJsonRpc` ⇄ `vscode-jsonrpc`).

## Prerequisites

- .NET SDK 9.0+
- Node.js 18+
- VS Code 1.85+

## Build & run

1. **Build the runner:**
   ```powershell
   cd runner/LinqRunner
   dotnet build
   ```
2. **Build the extension:**
   ```powershell
   cd extension
   npm install
   npm run compile
   ```
3. **Launch:** open the `extension/` folder in VS Code and press <kbd>F5</kbd> (Run Extension).
4. In the extension host window, open `examples/hello.linq.csx` and press
   <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (or run **LINQ: Run Current File**).

## Try the runner without VS Code

The runner has a CLI verb for headless testing:

```powershell
cd runner/LinqRunner
dotnet run -- execute ../../examples/hello.linq.csx
```

It prints the serialized result as JSON.

## Commands

| Command | Default key | Description |
|---|---|---|
| `LINQ: Run Current File` | <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Execute the active editor's contents |
| `LINQ: Restart Runner` | — | Kill and restart the runner process |

## Settings

| Setting | Default | Description |
|---|---|---|
| `linqRunner.dotnetPath` | `dotnet` | dotnet executable used to launch the runner |
| `linqRunner.runnerPath` | *(empty)* | Absolute path to `LinqRunner.dll`; empty = bundled `../runner` build |
| `linqRunner.rowLimit` | `1000` | Max rows materialized from a sequence result |

## Notes / not yet implemented

- No database, EF Core, assembly references, or NuGet yet (later milestones).
- Result inspection is intentionally shallow (sequences → tables, objects → one level).
- Executing scripts runs arbitrary C# — **treat query files as executable code.**
