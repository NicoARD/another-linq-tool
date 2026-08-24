using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text;

namespace LinqRunner.Results;

/// <summary>
/// Turns an arbitrary result value into a safe, depth-bounded, shape-tagged <see cref="ResultNode"/>.
/// Sequences render as tables and nested values are retained as depth-bounded nodes so the client
/// can expose them as a navigable tree without risking unbounded traversal.
/// </summary>
public static class ResultSerializer
{
    private const int MaxDepth = 4;

    private static readonly HashSet<Type> ScalarTypes =
    [
        typeof(string), typeof(decimal), typeof(DateTime), typeof(DateTimeOffset),
        typeof(TimeSpan), typeof(Guid), typeof(DateOnly), typeof(TimeOnly),
    ];

    public static ResultNode Serialize(object? value, int rowLimit) =>
        BuildNode(value, rowLimit, 0, new HashSet<object>(ReferenceEqualityComparer.Instance));

    private static ResultNode BuildNode(object? value, int rowLimit, int depth, HashSet<object> ancestors)
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

        if (depth >= MaxDepth)
        {
            return new ResultNode { Kind = "scalar", TypeName = Pretty(type), Text = ShallowFormat(value) };
        }

        var tracked = !type.IsValueType;
        if (tracked && !ancestors.Add(value))
        {
            return new ResultNode { Kind = "scalar", TypeName = Pretty(type), Text = "<cycle>" };
        }

        try
        {
            if (value is IEnumerable enumerable and not string)
            {
                return BuildTable(enumerable, rowLimit, depth, ancestors);
            }

            return BuildObject(value, type, rowLimit, depth, ancestors);
        }
        finally
        {
            if (tracked)
            {
                ancestors.Remove(value);
            }
        }
    }

    private static bool IsScalar(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        return type.IsPrimitive || type.IsEnum || ScalarTypes.Contains(type);
    }

    private static ResultNode BuildObject(object value, Type type, int rowLimit, int depth, HashSet<object> ancestors)
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
                Node = BuildNestedNode(propertyValue, rowLimit, depth + 1, ancestors),
            });
        }

        return new ResultNode { Kind = "object", TypeName = Pretty(type), Properties = nodes };
    }

    private static ResultNode BuildTable(IEnumerable enumerable, int rowLimit, int depth, HashSet<object> ancestors)
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

        if (elementType is not null
            && !IsScalar(elementType)
            && elementType != typeof(string)
            && !typeof(IEnumerable).IsAssignableFrom(elementType))
        {
            var properties = ReadableProperties(elementType);
            var columns = properties.Select(p => p.Name).ToList();
            var rows = new List<List<string?>>(items.Count);
            var cells = new List<List<ResultNode>>(items.Count);

            foreach (var item in items)
            {
                var row = new List<string?>(properties.Count);
                var cellRow = new List<ResultNode>(properties.Count);
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
                    cellRow.Add(BuildNestedNode(cell, rowLimit, depth + 1, ancestors));
                }

                rows.Add(row);
                cells.Add(cellRow);
            }

            return new ResultNode
            {
                Kind = "table",
                TypeName = Pretty(enumerable.GetType()),
                Columns = columns,
                Rows = rows,
                Cells = cells,
                RowCount = items.Count,
                Truncated = truncated,
            };
        }

        // Sequence of scalars -> single "Value" column.
        var scalarRows = items.Select(item => new List<string?> { ShallowFormat(item) }).ToList();
        var scalarCells = items
            .Select(item => new List<ResultNode> { BuildNestedNode(item, rowLimit, depth + 1, ancestors) })
            .ToList();
        return new ResultNode
        {
            Kind = "table",
            TypeName = Pretty(enumerable.GetType()),
            Columns = ["Value"],
            Rows = scalarRows,
            Cells = scalarCells,
            RowCount = items.Count,
            Truncated = truncated,
        };
    }

    private static ResultNode BuildNestedNode(object? value, int rowLimit, int depth, HashSet<object> ancestors)
    {
        try
        {
            return BuildNode(value, rowLimit, depth, ancestors);
        }
        catch (Exception ex)
        {
            return new ResultNode
            {
                Kind = "scalar",
                TypeName = value?.GetType().Name,
                Text = $"<{ex.GetType().Name}: {ex.Message}>",
            };
        }
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
