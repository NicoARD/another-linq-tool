using LinqRunner.Results;
using LinqRunner.Data;

namespace LinqRunner.Scripting;

/// <summary>
/// Per-execution collector for values passed to <c>Dump()</c>. The current sink is stored in an
/// <see cref="AsyncLocal{T}"/> so it flows across the script's awaits, and is set/cleared around
/// each execution (executions are serialized by <see cref="ScriptExecutor"/>).
/// </summary>
public sealed class DumpSink(int rowLimit, EfCoreCommandCapture? sqlCapture = null)
{
    private static readonly AsyncLocal<DumpSink?> Slot = new();

    private readonly List<DumpNode> items = [];

    public static DumpSink? Current
    {
        get => Slot.Value;
        set => Slot.Value = value;
    }

    public IReadOnlyList<DumpNode> Items => items;

    public void Add(object? value, string? label)
    {
        // Serialization can enumerate an EF query. Take commands afterwards so they render below
        // the dump that caused them, rather than as an unrelated execution-level list.
        var scope = sqlCapture?.BeginScope();
        var serialized = ResultSerializer.Serialize(value, rowLimit);
        var sqlCommands = scope.HasValue ? sqlCapture!.CompleteScope(scope.Value) : null;
        items.Add(new DumpNode
        {
            Label = label,
            Value = serialized,
            SqlCommands = sqlCommands?.Count > 0 ? sqlCommands.ToList() : null,
        });
    }
}
