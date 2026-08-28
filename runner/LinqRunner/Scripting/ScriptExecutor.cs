using System.Diagnostics;
using LinqRunner.Data;
using LinqRunner.Loading;
using LinqRunner.Results;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;
using Microsoft.CodeAnalysis.Scripting.Hosting;

namespace LinqRunner.Scripting;

/// <summary>
/// Compiles and runs a C# script with Roslyn scripting.
/// The value of the final bare expression (a last line without a trailing semicolon) is captured
/// via <see cref="ScriptState{T}.ReturnValue"/> and serialized for display.
/// </summary>
public static class ScriptExecutor
{
    private const int OutputLimit = 64 * 1024;

    // Console redirection is process-global, so executions are serialized.
    private static readonly SemaphoreSlim ExecutionGate = new(1, 1);

    internal static readonly string[] DefaultImports =
    [
        "System",
        "System.Linq",
        "System.Collections.Generic",
        "System.Threading.Tasks",
        "System.Text",
        "LinqRunner.Api",
    ];

    public static async Task<ExecuteResult> ExecuteAsync(
        string source,
        int rowLimit,
        IReadOnlyList<string> assemblies,
        IReadOnlyList<string> imports,
        IReadOnlyList<string> packages,
        DbContextRequest dbRequest,
        CancellationToken cancellationToken,
        string? debugSourcePath = null,
        int debugSourceOffset = 0,
        string? debugSourceChecksum = null)
    {
        var stopwatch = Stopwatch.StartNew();

        ScriptDocument document;
        try
        {
            document = ScriptDocument.Parse(source);
        }
        catch (Exception ex)
        {
            return InfrastructureError($"Invalid script metadata: {ex.Message}", ex, stopwatch);
        }

        source = document.Source;
        if (!string.IsNullOrWhiteSpace(debugSourcePath))
        {
            if (debugSourceOffset < 0 || debugSourceOffset > source.Length)
            {
                return InfrastructureError("Invalid debugger source offset.", new ArgumentOutOfRangeException(nameof(debugSourceOffset)), stopwatch);
            }

            // Profile preludes are generated code. Hide them from the debugger and map the user-authored
            // portion back to the real editor document so regular VS Code breakpoints bind to the script.
            var escapedPath = debugSourcePath.Replace("\\", "\\\\").Replace("\"", "\\\"");
            var checksumDirective = string.IsNullOrWhiteSpace(debugSourceChecksum)
                ? string.Empty
                : $"#pragma checksum \"{escapedPath}\" \"{{8829d00f-11b8-4213-878b-770e8597ac16}}\" \"{debugSourceChecksum}\"\n";
            source = $"{checksumDirective}#line hidden\n{source[..debugSourceOffset]}\n#line 1 \"{escapedPath}\"\n{source[debugSourceOffset..]}";
        }

        source = document.Kind == ScriptKind.Program
            ? $"{source}\n\n#line hidden\nawait ProgramEntryPoint.InvokeAsync(Main)"
            : source;

        // Restore any profile NuGet packages and add the resolved DLLs to the assembly set so the loader
        // references and loads them (and their deps) exactly like application assemblies.
        IReadOnlyList<string> effectivePackages;
        try
        {
            effectivePackages = EfCoreDependencyPolicy.PreparePackages(packages, assemblies, dbRequest);
        }
        catch (Exception ex)
        {
            return InfrastructureError($"EF Core dependency resolution failed: {ex.Message}", ex, stopwatch);
        }

        var effectiveAssemblies = assemblies;
        if (effectivePackages.Count > 0)
        {
            try
            {
                var packageAssemblies = await Nuget.NuGetResolver.RestoreAsync(
                    effectivePackages,
                    $"net{Environment.Version.Major}.0",
                    cancellationToken);
                effectiveAssemblies = [.. assemblies, .. packageAssemblies];
            }
            catch (Exception ex)
            {
                return InfrastructureError($"NuGet restore failed: {ex.Message}", ex, stopwatch);
            }
        }

        try
        {
            EfCoreDependencyPolicy.Validate(effectiveAssemblies, dbRequest);
        }
        catch (Exception ex)
        {
            return InfrastructureError($"EF Core dependency validation failed: {ex.Message}", ex, stopwatch);
        }

        // Register the loaded user assemblies with Roslyn so both compilation (metadata references)
        // and execution (the registered instances) see the same types.
        var assemblyLoader = new InteractiveAssemblyLoader();
        assemblyLoader.RegisterDependency(typeof(Api.DumpExtensions).Assembly);

        UserAssemblyLoader.Result loaded;
        try
        {
            loaded = UserAssemblyLoader.Load(effectiveAssemblies);
        }
        catch (Exception ex)
        {
            return InfrastructureError($"Failed to load configured assemblies: {ex.Message}", ex, stopwatch);
        }

        foreach (var assembly in loaded.Assemblies)
        {
            assemblyLoader.RegisterDependency(assembly);
        }

        // Start before context construction as a custom factory may issue EF commands itself.
        using var sqlCapture = new EfCoreCommandCapture();

        // Build the user's DbContext (if configured) and expose it to the script as the `Db` global.
        object? dbContext = null;
        Type? globalsType = null;
        object? globals = null;
        IReadOnlyList<string> effectiveImports = imports
            .Concat(document.Namespaces)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (dbRequest.IsConfigured)
        {
            try
            {
                dbContext = DbContextBuilder.Create(dbRequest, loaded.Assemblies);
            }
            catch (Exception ex)
            {
                return InfrastructureError($"Failed to create DbContext: {ex.InnerException?.Message ?? ex.Message}", ex, stopwatch);
            }

            globalsType = typeof(Api.ScriptGlobals<>).MakeGenericType(dbContext.GetType());
            globals = Activator.CreateInstance(globalsType);
            globalsType.GetField("Db")!.SetValue(globals, dbContext);
            assemblyLoader.RegisterDependency(dbContext.GetType().Assembly);

            // Ensure EF Core extension methods (ToListAsync, EnsureCreated, ...) are in scope.
            if (!effectiveImports.Contains("Microsoft.EntityFrameworkCore"))
            {
                effectiveImports = [.. effectiveImports, "Microsoft.EntityFrameworkCore"];
            }
        }

        var options = ScriptOptions.Default
            .WithReferences(FrameworkReferences.Value)
            .AddReferences(typeof(Api.DumpExtensions).Assembly)
            .AddReferences(loaded.References)
            .WithImports(DefaultImports.Concat(effectiveImports));

        if (!string.IsNullOrWhiteSpace(debugSourcePath))
        {
            options = options
                .WithFilePath(debugSourcePath + ".linqrunner.g.cs")
                .WithEmitDebugInformation(true);
        }

        Script<object> script;
        using var encodedDebugSource = string.IsNullOrWhiteSpace(debugSourcePath)
            ? null
            : new MemoryStream(System.Text.Encoding.UTF8.GetBytes(source));
        try
        {
            script = encodedDebugSource is null
                ? CSharpScript.Create<object>(source, options, globalsType, assemblyLoader)
                : CSharpScript.Create<object>(encodedDebugSource, options, globalsType, assemblyLoader);
        }
        catch (Exception ex)
        {
            return RuntimeError(ex, stopwatch);
        }

        var diagnostics = script.Compile(cancellationToken);
        var errors = diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error).ToList();
        if (errors.Count > 0)
        {
            await DisposeContextAsync(dbContext);
            return new ExecuteResult
            {
                Status = "compileError",
                Diagnostics = Map(diagnostics),
                ElapsedMs = stopwatch.ElapsedMilliseconds,
            };
        }

        // The script's Console output is captured so it (a) never corrupts the stdio RPC channel
        // and (b) can be shown alongside the result. Console.Out/Error are process-global, hence the gate.
        var captured = new BoundedTextWriter(OutputLimit);
        var sink = new DumpSink(rowLimit, sqlCapture);
        var originalOut = Console.Out;
        var originalError = Console.Error;
        await ExecutionGate.WaitAsync(cancellationToken);
        try
        {
            Console.SetOut(captured);
            Console.SetError(captured);
            DumpSink.Current = sink;

            var state = await script.RunAsync(globals: globals, catchException: _ => true, cancellationToken);

            if (state.Exception is not null)
            {
                return Attach(RuntimeError(state.Exception, stopwatch, diagnostics), captured, sink, sqlCapture);
            }

            var finalResultScope = sqlCapture.BeginScope();
            var serializedReturnValue = ResultSerializer.Serialize(state.ReturnValue, rowLimit);
            var finalSqlCommands = sqlCapture.CompleteScope(finalResultScope);
            return Attach(new ExecuteResult
            {
                Status = "success",
                Value = serializedReturnValue,
                Diagnostics = Map(diagnostics, warningsOnly: true),
                SqlCommands = finalSqlCommands.Count > 0 ? finalSqlCommands.ToList() : null,
                ElapsedMs = stopwatch.ElapsedMilliseconds,
            }, captured, sink, sqlCapture);
        }
        catch (OperationCanceledException)
        {
            return Attach(new ExecuteResult { Status = "cancelled", ElapsedMs = stopwatch.ElapsedMilliseconds }, captured, sink, sqlCapture);
        }
        catch (CompilationErrorException ex)
        {
            return new ExecuteResult
            {
                Status = "compileError",
                Diagnostics = Map(ex.Diagnostics),
                ElapsedMs = stopwatch.ElapsedMilliseconds,
            };
        }
        catch (Exception ex)
        {
            return Attach(RuntimeError(ex, stopwatch), captured, sink, sqlCapture);
        }
        finally
        {
            Console.SetOut(originalOut);
            Console.SetError(originalError);
            DumpSink.Current = null;
            ExecutionGate.Release();
            await DisposeContextAsync(dbContext);
        }
    }

    // A fresh DbContext is created per execution, so it is disposed as soon as the script finishes.
    private static async ValueTask DisposeContextAsync(object? dbContext)
    {
        switch (dbContext)
        {
            case IAsyncDisposable asyncDisposable:
                await asyncDisposable.DisposeAsync();
                break;
            case IDisposable disposable:
                disposable.Dispose();
                break;
        }
    }

    private static ExecuteResult Attach(ExecuteResult result, BoundedTextWriter captured, DumpSink sink, EfCoreCommandCapture sqlCapture)
    {
        var text = captured.ToString();
        if (text.Length > 0)
        {
            result.Output = text;
            result.OutputTruncated = captured.Truncated ? true : null;
        }

        if (sink.Items.Count > 0)
        {
            result.Dumps = sink.Items.ToList();
        }

        var sqlCommands = sqlCapture.TakeUnassignedCommands();
        if (sqlCommands.Count > 0)
        {
            result.SqlCommands ??= [];
            result.SqlCommands.AddRange(sqlCommands);
        }

        return result;
    }

    private static ExecuteResult RuntimeError(Exception ex, Stopwatch stopwatch, IEnumerable<Diagnostic>? diagnostics = null) => new()
    {
        Status = "runtimeError",
        Error = ToError(ex),
        Diagnostics = diagnostics is null ? null : Map(diagnostics, warningsOnly: true),
        ElapsedMs = stopwatch.ElapsedMilliseconds,
    };

    private static ExecuteResult InfrastructureError(string message, Exception ex, Stopwatch stopwatch) => new()
    {
        Status = "infrastructureError",
        Error = new ErrorInfo
        {
            Type = ex.GetType().FullName ?? ex.GetType().Name,
            Message = message,
            Stack = ex.StackTrace,
        },
        ElapsedMs = stopwatch.ElapsedMilliseconds,
    };

    private static ErrorInfo ToError(Exception ex) => new()
    {
        Type = ex.GetType().FullName ?? ex.GetType().Name,
        Message = ex.Message,
        Stack = ex.StackTrace,
        Inner = ex.InnerException is null ? null : ToError(ex.InnerException),
    };

    private static List<DiagnosticInfo> Map(IEnumerable<Diagnostic> diagnostics, bool warningsOnly = false)
    {
        var result = new List<DiagnosticInfo>();
        foreach (var diagnostic in diagnostics)
        {
            if (diagnostic.Severity == DiagnosticSeverity.Hidden)
            {
                continue;
            }

            // Benign assembly version-unification warnings (common when the app's EF Core references
            // lower BCL reference assemblies than the running runtime). Suppress the noise.
            if (diagnostic.Id is "CS1701" or "CS1702" or "CS1705")
            {
                continue;
            }

            if (warningsOnly && diagnostic.Severity == DiagnosticSeverity.Error)
            {
                continue;
            }

            var position = diagnostic.Location.GetLineSpan().StartLinePosition;
            result.Add(new DiagnosticInfo
            {
                Severity = diagnostic.Severity.ToString().ToLowerInvariant(),
                Id = diagnostic.Id,
                Message = diagnostic.GetMessage(),
                Line = position.Line,
                Character = position.Character,
            });
        }

        return result;
    }
}
