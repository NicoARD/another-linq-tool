using System.Text;

namespace LinqRunner.Scripting;

/// <summary>
/// A <see cref="TextWriter"/> that accumulates script console output up to a character limit,
/// then silently drops the rest and flags truncation. Prevents a runaway script (e.g. an infinite
/// <c>Console.WriteLine</c> loop) from exhausting memory.
/// </summary>
internal sealed class BoundedTextWriter(int limit) : TextWriter
{
    private readonly StringBuilder builder = new();

    public bool Truncated { get; private set; }

    public override Encoding Encoding => Encoding.UTF8;

    public override void Write(char value)
    {
        if (builder.Length >= limit)
        {
            Truncated = true;
            return;
        }

        builder.Append(value);
    }

    public override void Write(string? value)
    {
        if (value is null)
        {
            return;
        }

        var remaining = limit - builder.Length;
        if (remaining <= 0)
        {
            Truncated = true;
            return;
        }

        if (value.Length > remaining)
        {
            builder.Append(value, 0, remaining);
            Truncated = true;
        }
        else
        {
            builder.Append(value);
        }
    }

    public override string ToString() => builder.ToString();
}
