using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace LinqRunner.Scripting;

internal enum ScriptKind
{
    Dynamic,
    Program,
}

internal sealed record ScriptDocument(string Source, ScriptKind Kind, IReadOnlyList<string> Namespaces)
{
    private static readonly Regex QueryHeader = new(
        @"^[ \t]*<Query\b[\s\S]*?^[ \t]*</Query\s*>[ \t]*\r?$",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);

    private static readonly Regex Directive = new(
        @"^[ \t]*(?://[ \t]*)?@(kind|query|namespace)[ \t]+(.+?)[ \t]*\r?$",
        RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static ScriptDocument Parse(string source)
    {
        var masked = source.ToCharArray();
        var namespaces = new List<string>();
        var kind = ScriptKind.Dynamic;

        var header = QueryHeader.Match(source);
        if (header.Success)
        {
            var query = XDocument.Parse(header.Value.Trim()).Root
                ?? throw new FormatException("The LINQPad Query header is empty.");

            kind = ParseKind(query.Attribute("Kind")?.Value);
            namespaces.AddRange(query.Elements()
                .Where(element => element.Name.LocalName.Equals("Namespace", StringComparison.OrdinalIgnoreCase))
                .Select(element => element.Value.Trim())
                .Where(value => value.Length > 0));
            Mask(masked, header.Index, header.Length);
        }

        foreach (Match directive in Directive.Matches(source))
        {
            var name = directive.Groups[1].Value;
            var value = directive.Groups[2].Value.Trim();
            if (name.Equals("namespace", StringComparison.OrdinalIgnoreCase))
            {
                if (value.Length > 0)
                {
                    namespaces.Add(value);
                }
            }
            else
            {
                kind = ParseKind(value);
            }

            Mask(masked, directive.Index, directive.Length);
        }

        return new ScriptDocument(
            new string(masked),
            kind,
            namespaces.Distinct(StringComparer.Ordinal).ToArray());
    }

    private static ScriptKind ParseKind(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        null or "" or "expression" or "statements" => ScriptKind.Dynamic,
        "program" => ScriptKind.Program,
        _ => throw new FormatException($"Unsupported query kind '{value}'. Expected Program, Expression, or Statements."),
    };

    private static void Mask(char[] source, int index, int length)
    {
        for (var i = index; i < index + length; i++)
        {
            if (source[i] is not '\r' and not '\n')
            {
                source[i] = ' ';
            }
        }
    }
}
