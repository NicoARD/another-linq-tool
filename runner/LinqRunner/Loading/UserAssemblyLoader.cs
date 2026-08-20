using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using LinqRunner.Scripting;
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

    // directories the configured assemblies live in, used to probe managed + native dependencies.
    private static readonly HashSet<string> ProbeDirectories = new(StringComparer.OrdinalIgnoreCase);

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

                ProbeDirectories.Add(directory);

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

            // Also reference sibling DLLs that are NOT part of the shared framework (e.g. EF Core, the
            // provider, other app dependencies) so their types are usable at compile time, not just at
            // runtime. Framework assemblies are excluded to avoid duplicate references.
            var referencedPaths = new HashSet<string>(fullPaths, StringComparer.OrdinalIgnoreCase);
            foreach (var (name, path) in ProbeRegistry)
            {
                if (FrameworkReferences.Names.Contains(name) || referencedPaths.Contains(path))
                {
                    continue;
                }

                try
                {
                    result.References.Add(MetadataReference.CreateFromImage(File.ReadAllBytes(path)));
                    referencedPaths.Add(path);
                }
                catch
                {
                    // Skip anything that isn't a valid managed assembly.
                }
            }

            return result;
        }
    }

    /// <summary>Loads an assembly by simple name from the probed directories (used for framework/provider
    /// assemblies the DbContext builder needs via reflection). Returns null if it cannot be found.</summary>
    public static Assembly? LoadByName(string simpleName)
    {
        lock (Gate)
        {
            if (ProbeRegistry.TryGetValue(simpleName, out var path) && File.Exists(path))
            {
                if (LoadedByPath.TryGetValue(path, out var existing))
                {
                    return existing;
                }

                var assembly = AssemblyLoadContext.Default.LoadFromStream(new MemoryStream(File.ReadAllBytes(path)));
                LoadedByPath[path] = assembly;
                return assembly;
            }
        }

        return AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => string.Equals(a.GetName().Name, simpleName, StringComparison.OrdinalIgnoreCase));
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

        // Native libraries (e.g. e_sqlite3) are resolved from the app's runtimes/<rid>/native folders,
        // which the default native search path does not cover for dynamically loaded assemblies.
        AssemblyLoadContext.Default.ResolvingUnmanagedDll += (assembly, libraryName) =>
        {
            lock (Gate)
            {
                foreach (var directory in NativeProbeDirectories())
                {
                    foreach (var candidate in NativeFileNames(libraryName))
                    {
                        var path = Path.Combine(directory, candidate);
                        if (File.Exists(path) && NativeLibrary.TryLoad(path, out var handle))
                        {
                            return handle;
                        }
                    }
                }
            }

            return IntPtr.Zero;
        };

        resolverInstalled = true;
    }

    private static IEnumerable<string> NativeProbeDirectories()
    {
        var rid = RuntimeIdentifier();
        foreach (var directory in ProbeDirectories)
        {
            yield return directory;
            var native = Path.Combine(directory, "runtimes", rid, "native");
            if (Directory.Exists(native))
            {
                yield return native;
            }
        }
    }

    private static IEnumerable<string> NativeFileNames(string libraryName)
    {
        yield return libraryName;
        if (OperatingSystem.IsWindows())
        {
            yield return libraryName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) ? libraryName : libraryName + ".dll";
        }
        else if (OperatingSystem.IsMacOS())
        {
            yield return $"lib{libraryName}.dylib";
        }
        else
        {
            yield return $"lib{libraryName}.so";
        }
    }

    private static string RuntimeIdentifier()
    {
        var os = OperatingSystem.IsWindows() ? "win"
            : OperatingSystem.IsMacOS() ? "osx"
            : "linux";
        var arch = RuntimeInformation.ProcessArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.X86 => "x86",
            Architecture.Arm64 => "arm64",
            Architecture.Arm => "arm",
            _ => "x64",
        };
        return $"{os}-{arch}";
    }
}
