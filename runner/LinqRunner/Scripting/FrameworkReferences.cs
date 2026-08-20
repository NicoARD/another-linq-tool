using Microsoft.CodeAnalysis;

namespace LinqRunner.Scripting;

/// <summary>
/// Metadata references for scripts. For the POC we expose the full shared framework by referencing
/// the runtime's Trusted Platform Assemblies, so scripts can use the whole BCL (LINQ, collections,
/// tasks, etc.) without any per-script configuration. Assembly loading for user DLLs comes later.
/// </summary>
internal static class FrameworkReferences
{
    public static readonly IReadOnlyList<MetadataReference> Value = Build();

    /// <summary>Simple names (no extension) of the framework assemblies, used to avoid re-referencing
    /// framework DLLs that also appear beside user assemblies.</summary>
    public static readonly HashSet<string> Names = BuildNames();

    private static IReadOnlyList<MetadataReference> Build()
    {
        var tpa = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? string.Empty;

        // Exclude the runner's own assembly; it is added explicitly (with its import) for the Dump API,
        // which keeps exactly one reference to it and avoids duplicate-reference warnings.
        var selfPath = typeof(FrameworkReferences).Assembly.Location;

        return tpa
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Where(path => path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                && File.Exists(path)
                && !string.Equals(path, selfPath, StringComparison.OrdinalIgnoreCase))
            .Select(path =>
            {
                try
                {
                    return (MetadataReference)MetadataReference.CreateFromFile(path);
                }
                catch
                {
                    return null;
                }
            })
            .Where(reference => reference is not null)
            .Cast<MetadataReference>()
            .ToList();
    }

    private static HashSet<string> BuildNames()
    {
        var tpa = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? string.Empty;
        return tpa
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Where(path => path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            .Select(Path.GetFileNameWithoutExtension)
            .Where(name => !string.IsNullOrEmpty(name))
            .Cast<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}
