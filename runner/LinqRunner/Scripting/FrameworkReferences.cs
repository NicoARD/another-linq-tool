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

    private static IReadOnlyList<MetadataReference> Build()
    {
        var tpa = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? string.Empty;

        return tpa
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Where(path => path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) && File.Exists(path))
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
}
