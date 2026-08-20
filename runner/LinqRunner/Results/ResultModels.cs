namespace LinqRunner.Results;

/// <summary>Wire model returned for an `execute` request.</summary>
public sealed class ExecuteResult
{
    // "success" | "compileError" | "runtimeError" | "cancelled"
    public string Status { get; set; } = "success";
    public ResultNode? Value { get; set; }
    public List<DumpNode>? Dumps { get; set; }
    public List<DiagnosticInfo>? Diagnostics { get; set; }
    public ErrorInfo? Error { get; set; }
    public string? Output { get; set; }
    public bool? OutputTruncated { get; set; }
    public long ElapsedMs { get; set; }
}

public sealed class DumpNode
{
    public string? Label { get; set; }
    public ResultNode Value { get; set; } = new();
}

public sealed class DiagnosticInfo
{
    public string Severity { get; set; } = "error"; // error | warning | info
    public string Id { get; set; } = "";
    public string Message { get; set; } = "";
    public int Line { get; set; }        // 0-based
    public int Character { get; set; }   // 0-based
}

public sealed class ErrorInfo
{
    public string Type { get; set; } = "";
    public string Message { get; set; } = "";
    public string? Stack { get; set; }
    public ErrorInfo? Inner { get; set; }
}

/// <summary>A shape-tagged, depth-bounded view of a result value.</summary>
public sealed class ResultNode
{
    public string Kind { get; set; } = "null"; // null | scalar | object | table

    public string? TypeName { get; set; }

    // scalar
    public string? Text { get; set; }

    // object
    public List<PropertyNode>? Properties { get; set; }

    // table
    public List<string>? Columns { get; set; }
    public List<List<string?>>? Rows { get; set; }
    public int? RowCount { get; set; }
    public bool? Truncated { get; set; }
}

public sealed class PropertyNode
{
    public string Name { get; set; } = "";
    public string? TypeName { get; set; }
    public string? Value { get; set; }
}
