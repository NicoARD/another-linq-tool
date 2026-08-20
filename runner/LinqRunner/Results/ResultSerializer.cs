using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text;

namespace LinqRunner.Results;

/// <summary>
/// Turns an arbitrary result value into a safe, shallow, shape-tagged <see cref="ResultNode"/>.
/// Intentionally shallow for the POC: sequences render as tables, single objects render their
/// public properties one level deep, and nested values are summarised rather than fully expanded.
/// </summary>
public static class ResultSerializer
{
    private static readonly HashSet<Type> ScalarTypes =
    [
        typeof(string), typeof(decimal), typeof(DateTime), typeof(DateTimeOffset),
        typeof(TimeSpan), typeof(Guid), typeof(DateOnly), typeof(TimeOnly),
    ];

    public static ResultNode Serialize(object? value, int rowLimit)
    {
        if (value is null)
        {
            return new ResultNode { Kind = "null" };
        }

        var type = value.GetType();

        if (IsScalar(type))
        {
            return new ResultNode { Kind = "scalar", TypeName = Pretty(type), Text = Format(value) };
        }

        if (value is IEnumerable enumerable and not string)
        {
            return BuildTable(enumerable, rowLimit);
        }

        return BuildObject(value, type);
    }

    private static bool IsScalar(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        return type.IsPrimitive || type.IsEnum || ScalarTypes.Contains(type);
    }

    private static ResultNode BuildObject(object value, Type type)
    {
        var properties = ReadableProperties(type);
        var nodes = new List<PropertyNode>(properties.Count);

        foreach (var property in properties)
        {
            object? propertyValue;
            try
            {
                propertyValue = property.GetValue(value);
            }
            catch (Exception ex)
            {
                propertyValue = $"<{ex.GetType().Name}>";
            }

            nodes.Add(new PropertyNode
            {
                Name = property.Name,
                TypeName = Pretty(property.PropertyType),
                Value = ShallowFormat(propertyValue),
            });
        }

        return new ResultNode { Kind = "object", TypeName = Pretty(type), Properties = nodes };
    }

    private static ResultNode BuildTable(IEnumerable enumerable, int rowLimit)
    {
        var items = new List<object?>();
        var truncated = false;

        foreach (var item in enumerable)
        {
            if (items.Count >= rowLimit)
            {
                truncated = true;
                break;
            }

            items.Add(item);
        }

        var elementType = GetElementType(enumerable.GetType())
            ?? items.FirstOrDefault(x => x is not null)?.GetType();

        if (elementType is not null && !IsScalar(elementType) && elementType != typeof(string))
        {
            var properties = ReadableProperties(elementType);
            var columns = properties.Select(p => p.Name).ToList();
            var rows = new List<List<string?>>(items.Count);

            foreach (var item in items)
            {
                var row = new List<string?>(properties.Count);
                foreach (var property in properties)
                {
                    object? cell;
                    try
                    {
                        cell = item is null ? null : property.GetValue(item);
                    }
                    catch (Exception ex)
                    {
                        cell = $"<{ex.GetType().Name}>";
                    }

                    row.Add(ShallowFormat(cell));
                }

                rows.Add(row);
            }

            return new ResultNode
            {
                Kind = "table",
                TypeName = Pretty(enumerable.GetType()),
                Columns = columns,
                Rows = rows,
                RowCount = items.Count,
                Truncated = truncated,
            };
        }

        // Sequence of scalars -> single "Value" column.
        var scalarRows = items.Select(item => new List<string?> { ShallowFormat(item) }).ToList();
        return new ResultNode
        {
            Kind = "table",
            TypeName = Pretty(enumerable.GetType()),
            Columns = ["Value"],
            Rows = scalarRows,
            RowCount = items.Count,
            Truncated = truncated,
        };
    }

    private static List<PropertyInfo> ReadableProperties(Type type) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.CanRead && p.GetIndexParameters().Length == 0)
            .ToList();

    private static Type? GetElementType(Type collectionType) =>
        collectionType.GetInterfaces()
            .Where(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEnumerable<>))
            .Select(i => i.GetGenericArguments()[0])
            .FirstOrDefault(t => t != typeof(object));

    private static string ShallowFormat(object? value)
    {
        if (value is null)
        {
            return "null";
        }

        var type = value.GetType();
        if (IsScalar(type))
        {
            return Format(value);
        }

        if (value is IEnumerable and not string)
        {
            return "[…]";
        }

        return $"{{ {Pretty(type)} }}";
    }

    private static string Format(object? value)
    {
        return value switch
        {
            null => "null",
            bool b => b ? "true" : "false",
            IFormattable f when value is double or float or decimal or DateTime or DateTimeOffset or DateOnly or TimeOnly
                => f.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString() ?? "",
        };
    }

    private static string Pretty(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;

        if (IsAnonymous(type))
        {
            return "anonymous";
        }

        if (!type.IsGenericType)
        {
            return Alias(type);
        }

        var name = type.Name;
        var tick = name.IndexOf('`', StringComparison.Ordinal);
        if (tick >= 0)
        {
            name = name[..tick];
        }

        var args = type.GetGenericArguments().Select(Pretty);
        return new StringBuilder(name).Append('<').Append(string.Join(", ", args)).Append('>').ToString();
    }

    private static bool IsAnonymous(Type type) =>
        type.Namespace is null && type.Name.Contains("AnonymousType", StringComparison.Ordinal);

    private static string Alias(Type type) => type.Name switch
    {
        nameof(Int32) => "int",
        nameof(Int64) => "long",
        nameof(Boolean) => "bool",
        nameof(String) => "string",
        nameof(Double) => "double",
        nameof(Single) => "float",
        nameof(Decimal) => "decimal",
        nameof(Object) => "object",
        _ => type.Name,
    };
}
