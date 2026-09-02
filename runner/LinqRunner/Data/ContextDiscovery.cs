using System.Reflection;
using LinqRunner.Loading;

namespace LinqRunner.Data;

/// <summary>
/// Reflects over the user-configured DLLs to find concrete <c>DbContext</c> subclasses,
/// so the configuration UI can offer them as choices instead of free text.
/// </summary>
public static class ContextDiscovery
{
    private const string DbContextFullName = "Microsoft.EntityFrameworkCore.DbContext";

    public static IReadOnlyList<string> Discover(IReadOnlyList<string> assemblyPaths)
    {
        var loaded = UserAssemblyLoader.Load(CandidatePaths(assemblyPaths));
        var found = new SortedSet<string>(StringComparer.Ordinal);

        foreach (var assembly in loaded.Assemblies)
        {
            foreach (var type in SafeGetTypes(assembly))
            {
                if (type is null || type.IsAbstract || !type.IsClass || type.FullName is null)
                {
                    continue;
                }

                if (InheritsDbContext(type))
                {
                    found.Add(type.FullName);
                }
            }
        }

        return found.ToList();
    }

    /// <summary>
    /// The configured DLLs plus the non-framework DLLs sitting beside them, so a DbContext that lives
    /// in a referenced project's assembly (not the configured one) is still discovered.
    /// </summary>
    private static List<string> CandidatePaths(IReadOnlyList<string> assemblyPaths)
    {
        var paths = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string path)
        {
            if (seen.Add(Path.GetFullPath(path)))
            {
                paths.Add(path);
            }
        }

        foreach (var configured in assemblyPaths.Where(File.Exists))
        {
            Add(configured);
        }

        var directories = assemblyPaths
            .Where(File.Exists)
            .Select(Path.GetDirectoryName)
            .Where(dir => dir is not null)
            .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var directory in directories)
        {
            foreach (var dll in Directory.EnumerateFiles(directory!, "*.dll"))
            {
                if (!IsFrameworkAssembly(dll))
                {
                    Add(dll);
                }
            }
        }

        return paths;
    }

    private static bool IsFrameworkAssembly(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path);
        return name.StartsWith("System.", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("Microsoft.", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("runtime.", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("Windows.", StringComparison.OrdinalIgnoreCase)
            || name is "netstandard" or "mscorlib" or "WindowsBase" or "PresentationCore" or "PresentationFramework";
    }

    private static bool InheritsDbContext(Type type)
    {
        for (var current = type.BaseType; current is not null; current = current.BaseType)
        {
            if (current.FullName == DbContextFullName)
            {
                return true;
            }
        }

        return false;
    }

    private static IEnumerable<Type?> SafeGetTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types;
        }
        catch
        {
            return [];
        }
    }
}
