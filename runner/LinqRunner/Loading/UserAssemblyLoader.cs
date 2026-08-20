using System.Reflection;
using System.Runtime.Loader;
using Microsoft.CodeAnalysis;

namespace LinqRunner.Loading;

/// <summary>
/// Loads user-configured application DLLs so scripts can reference their types.
///
/// Design for the POC:
/// - Assemblies are read as bytes and loaded via <see cref="AssemblyLoadContext.LoadFromStream(System.IO.Stream)"/>,
///   so the original files are NOT locked and can be rebuilt while the runner is alive.
/// - Everything loads into the default context (no separate collectible context), which keeps
///   assembly identity unambiguous between the script submission and the loaded types.
/// - A single <see cref="AssemblyLoadContext.Resolving"/> hook resolves each loaded assembly's
///   dependencies by probing the directories the configured assemblies live in.
/// - Because the default context cannot be unloaded, picking up a NEW build requires restarting the
///   runner process (LINQ: Restart Runner) — matching the architecture's "process restart" reload model.
/// </summary>
public static class UserAssemblyLoader
{
    private static readonly object Gate = new();

    // simple assembly name -> file path, used by the runtime dependency-resolution hook.
    private static readonly Dictionary<string, string> ProbeRegistry = new(StringComparer.OrdinalIgnoreCase);

    // absolute path -> already-loaded assembly, so repeated executions reuse one instance.
    private static readonly Dictionary<string, Assembly> LoadedByPath = new(StringComparer.OrdinalIgnoreCase);

    private static bool resolverInstalled;

    public sealed class Result
    {
        public List<Assembly> Assemblies { get; } = [];
        public List<MetadataReference> References { get; } = [];
    }

    public static Result Load(IReadOnlyList<string> assemblyPaths)
    {
        lock (Gate)
        {
            InstallResolver();

            var result = new Result();
            var fullPaths = assemblyPaths
                .Select(Path.GetFullPath)
                .Where(File.Exists)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Index sibling directories so transitive dependencies can be probed at runtime.
            foreach (var directory in fullPaths.Select(Path.GetDirectoryName).Distinct())
            {
                if (directory is null)
                {
                    continue;
                }

                foreach (var dll in Directory.EnumerateFiles(directory, "*.dll"))
                {
                    ProbeRegistry.TryAdd(Path.GetFileNameWithoutExtension(dll), dll);
                }
            }

            foreach (var path in fullPaths)
            {
                var bytes = File.ReadAllBytes(path);

                if (!LoadedByPath.TryGetValue(path, out var assembly))
                {
                    assembly = AssemblyLoadContext.Default.LoadFromStream(new MemoryStream(bytes));
                    LoadedByPath[path] = assembly;
                }

                result.Assemblies.Add(assembly);
                result.References.Add(MetadataReference.CreateFromImage(bytes));
            }

            return result;
        }
    }

    private static void InstallResolver()
    {
        if (resolverInstalled)
        {
            return;
        }

        AssemblyLoadContext.Default.Resolving += (context, name) =>
        {
            if (name.Name is null)
            {
                return null;
            }

            lock (Gate)
            {
                if (ProbeRegistry.TryGetValue(name.Name, out var path) && File.Exists(path))
                {
                    try
                    {
                        return context.LoadFromStream(new MemoryStream(File.ReadAllBytes(path)));
                    }
                    catch
                    {
                        return null;
                    }
                }
            }

            return null;
        };

        resolverInstalled = true;
    }
}
