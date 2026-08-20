using LinqRunner.Results;

namespace LinqRunner.Scripting;

/// <summary>
/// Per-execution collector for values passed to <c>Dump()</c>. The current sink is stored in an
/// <see cref="AsyncLocal{T}"/> so it flows across the script's awaits, and is set/cleared around
/// each execution (executions are serialized by <see cref="ScriptExecutor"/>).
/// </summary>
public sealed class DumpSink(int rowLimit)
{
    private static readonly AsyncLocal<DumpSink?> Slot = new();

    private readonly List<DumpNode> items = [];

    public static DumpSink? Current
    {
        get => Slot.Value;
        set => Slot.Value = value;
    }

    public IReadOnlyList<DumpNode> Items => items;

    public void Add(object? value, string? label) =>
        items.Add(new DumpNode { Label = label, Value = ResultSerializer.Serialize(value, rowLimit) });
}
