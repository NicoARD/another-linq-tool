using LinqRunner.Scripting;

namespace LinqRunner.Api;

/// <summary>
/// <c>Dump()</c>. Renders a value in the result panel and returns the same value so
/// calls can be chained (<c>var x = query.Dump();</c>) or used mid-expression. Available to scripts
/// via the imported <c>LinqRunner.Api</c> namespace.
/// </summary>
public static class DumpExtensions
{
    public static T Dump<T>(this T value, string? label = null)
    {
        DumpSink.Current?.Add(value, label);
        return value;
    }
}
