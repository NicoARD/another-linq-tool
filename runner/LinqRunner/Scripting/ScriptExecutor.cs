using System.Diagnostics;
using LinqRunner.Results;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace LinqRunner.Scripting;

/// <summary>
/// Compiles and runs a C# script (LINQPad-style) with Roslyn scripting.
/// The value of the final bare expression (a last line without a trailing semicolon) is captured
/// via <see cref="ScriptState{T}.ReturnValue"/> and serialized for display.
/// </summary>
public static class ScriptExecutor
{
    private static readonly string[] DefaultImports =
    [
        "System",
        "System.Linq",
        "System.Collections.Generic",
        "System.Threading.Tasks",
        "System.Text",
    ];

    public static async Task<ExecuteResult> ExecuteAsync(string source, int rowLimit, CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();

        var options = ScriptOptions.Default
            .WithReferences(FrameworkReferences.Value)
            .WithImports(DefaultImports);

        Script<object> script;
        try
        {
            script = CSharpScript.Create<object>(source, options);
        }
        catch (Exception ex)
        {
            return RuntimeError(ex, stopwatch);
        }

        var diagnostics = script.Compile(cancellationToken);
        var errors = diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error).ToList();
        if (errors.Count > 0)
        {
            return new ExecuteResult
            {
                Status = "compileError",
                Diagnostics = Map(diagnostics),
                ElapsedMs = stopwatch.ElapsedMilliseconds,
            };
        }

        try
        {
            var state = await script.RunAsync(globals: null, catchException: _ => true, cancellationToken);

            if (state.Exception is not null)
            {
                return RuntimeError(state.Exception, stopwatch, diagnostics);
            }

            return new ExecuteResult
            {
                Status = "success",
                Value = ResultSerializer.Serialize(state.ReturnValue, rowLimit),
                Diagnostics = Map(diagnostics, warningsOnly: true),
                ElapsedMs = stopwatch.ElapsedMilliseconds,
            };
        }
        catch (OperationCanceledException)
        {
            return new ExecuteResult { Status = "cancelled", ElapsedMs = stopwatch.ElapsedMilliseconds };
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
            return RuntimeError(ex, stopwatch);
        }
    }

    private static ExecuteResult RuntimeError(Exception ex, Stopwatch stopwatch, IEnumerable<Diagnostic>? diagnostics = null) => new()
    {
        Status = "runtimeError",
        Error = ToError(ex),
        Diagnostics = diagnostics is null ? null : Map(diagnostics, warningsOnly: true),
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
