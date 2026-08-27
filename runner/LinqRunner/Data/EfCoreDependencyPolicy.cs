using System.Reflection;

namespace LinqRunner.Data;

/// <summary>Keeps a profile's EF Core runtime and provider in one compatible version family.</summary>
public static class EfCoreDependencyPolicy
{
    private const string EfPrefix = "Microsoft.EntityFrameworkCore";

    public static IReadOnlyList<string> PreparePackages(
        IReadOnlyList<string> packages,
        IReadOnlyList<string> assemblies,
        DbContextRequest request)
    {
        if (!request.IsConfigured || !string.IsNullOrWhiteSpace(request.FactoryType))
        {
            return packages;
        }

        var providerPackage = ProviderPackage(request.Provider);
        var result = packages.ToList();
        var configuredProvider = FindPackage(result, providerPackage);
        var providerPath = FindAssembly(assemblies, providerPackage);

        if (!string.IsNullOrWhiteSpace(request.EfCoreVersion))
        {
            ValidateVersionSelector(request.EfCoreVersion);
            AlignConfiguredEfPackages(result, request.EfCoreVersion);

            if (configuredProvider is not null)
            {
                result[configuredProvider.Value.Index] = $"{providerPackage}@{request.EfCoreVersion}";
            }
            else if (providerPath is null)
            {
                result.Add($"{providerPackage}@{request.EfCoreVersion}");
            }

            return result;
        }

        if (configuredProvider is not null || providerPath is not null)
        {
            return result;
        }

        var detected = FindPackage(result, EfPrefix)?.Version ?? DetectVersion(assemblies);
        if (string.IsNullOrWhiteSpace(detected))
        {
            throw new InvalidOperationException(
                $"'{providerPackage}' is not available beside the configured assemblies. " +
                "Set an EF Core version in the profile so the matching provider can be restored.");
        }

        result.Add($"{providerPackage}@{detected}");
        return result;
    }

    public static void Validate(IReadOnlyList<string> assemblyPaths, DbContextRequest request)
    {
        if (!request.IsConfigured)
        {
            return;
        }

        var candidates = EnumerateEfAssemblies(assemblyPaths)
            .Select(path =>
            {
                try
                {
                    var name = AssemblyName.GetAssemblyName(path);
                    return new EfAssembly(name.Name!, name.Version ?? new Version(0, 0), path);
                }
                catch
                {
                    return null;
                }
            })
            .Where(item => item is not null)
            .Cast<EfAssembly>()
            .ToList();

        foreach (var group in candidates.GroupBy(item => item.Name, StringComparer.OrdinalIgnoreCase))
        {
            var versions = group.Select(item => item.Version).Distinct().ToList();
            if (versions.Count > 1)
            {
                throw new InvalidOperationException(
                    $"Conflicting {group.Key} versions were found: " +
                    string.Join(", ", group.Select(item => $"{item.Version} ({item.Path})")) +
                    ". Use one EF Core dependency set per profile.");
            }
        }

        var providerName = ProviderPackageOrEmpty(request.Provider);
        var family = candidates.Where(item =>
                item.Name.Equals(EfPrefix, StringComparison.OrdinalIgnoreCase)
                || item.Name.Equals(EfPrefix + ".Relational", StringComparison.OrdinalIgnoreCase)
                || item.Name.Equals(providerName, StringComparison.OrdinalIgnoreCase))
            .ToList();
        var familyVersions = family.Select(item => MajorMinor(item.Version)).Distinct().ToList();

        if (familyVersions.Count > 1)
        {
            throw new InvalidOperationException(
                "The EF Core runtime, relational library, and database provider must use the same major/minor version: " +
                string.Join(", ", family.Select(item => $"{item.Name} {item.Version} ({item.Path})")));
        }

        if (!string.IsNullOrWhiteSpace(request.EfCoreVersion)
            && ParseMajorMinor(request.EfCoreVersion) is { } requested
            && familyVersions.FirstOrDefault() is { } actual
            && actual != requested)
        {
            throw new InvalidOperationException(
                $"The profile selects EF Core {request.EfCoreVersion}, but the configured application supplies EF Core {actual}. " +
                "Select the application's EF Core version or rebuild the application against the selected version.");
        }
    }

    private static string ProviderPackage(string? provider) => provider?.Trim().ToLowerInvariant() switch
    {
        "sqlite" => EfPrefix + ".Sqlite",
        "sqlserver" => EfPrefix + ".SqlServer",
        _ => throw new InvalidOperationException(
            $"Unsupported provider '{provider}'. Supported: 'sqlite', 'sqlserver'."),
    };

    private static string ProviderPackageOrEmpty(string? provider)
    {
        try { return ProviderPackage(provider); }
        catch { return string.Empty; }
    }

    private static (int Index, string Version)? FindPackage(IReadOnlyList<string> packages, string id)
    {
        for (var index = 0; index < packages.Count; index++)
        {
            var parts = packages[index].Split('@', 2, StringSplitOptions.TrimEntries);
            if (parts[0].Equals(id, StringComparison.OrdinalIgnoreCase))
            {
                return (index, parts.Length > 1 && parts[1].Length > 0 ? parts[1] : "*");
            }
        }
        return null;
    }

    private static void AlignConfiguredEfPackages(IList<string> packages, string requestedVersion)
    {
        for (var index = 0; index < packages.Count; index++)
        {
            var parts = packages[index].Split('@', 2, StringSplitOptions.TrimEntries);
            if (!parts[0].StartsWith(EfPrefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            packages[index] = $"{parts[0]}@{requestedVersion}";
        }
    }

    private static string? DetectVersion(IReadOnlyList<string> assemblies)
    {
        var path = FindAssembly(assemblies, EfPrefix) ?? FindAssembly(assemblies, EfPrefix + ".Relational");
        if (path is null)
        {
            return null;
        }
        var version = AssemblyName.GetAssemblyName(path).Version;
        return version is null
            ? null
            : version.Build >= 0 ? $"{version.Major}.{version.Minor}.{version.Build}" : $"{version.Major}.{version.Minor}.*";
    }

    private static string? FindAssembly(IReadOnlyList<string> assemblies, string simpleName)
    {
        foreach (var assembly in assemblies)
        {
            if (Path.GetFileNameWithoutExtension(assembly).Equals(simpleName, StringComparison.OrdinalIgnoreCase)
                && File.Exists(assembly))
            {
                return assembly;
            }
            var directory = Path.GetDirectoryName(assembly);
            var candidate = directory is null ? null : Path.Combine(directory, simpleName + ".dll");
            if (candidate is not null && File.Exists(candidate))
            {
                return candidate;
            }
        }
        return null;
    }

    private static IEnumerable<string> EnumerateEfAssemblies(IReadOnlyList<string> assemblyPaths)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in assemblyPaths)
        {
            if (Path.GetFileName(path).StartsWith(EfPrefix, StringComparison.OrdinalIgnoreCase)
                && File.Exists(path)
                && seen.Add(Path.GetFullPath(path)))
            {
                yield return Path.GetFullPath(path);
            }

            var directory = Path.GetDirectoryName(path);
            if (directory is null || !Directory.Exists(directory))
            {
                continue;
            }
            foreach (var sibling in Directory.EnumerateFiles(directory, EfPrefix + "*.dll"))
            {
                if (seen.Add(Path.GetFullPath(sibling)))
                {
                    yield return Path.GetFullPath(sibling);
                }
            }
        }
    }

    private static void ValidateVersionSelector(string value)
    {
        if (ParseMajorMinor(value) is null)
        {
            throw new InvalidOperationException(
                $"Invalid EF Core version '{value}'. Use a version such as '8.0.19' or '8.*'.");
        }
    }

    private static string MajorMinor(Version version) => $"{version.Major}.{version.Minor}";

    private static string? ParseMajorMinor(string value)
    {
        var parts = value.Trim().Split('.', StringSplitOptions.TrimEntries);
        if (parts.Length == 0 || !int.TryParse(parts[0], out var major))
        {
            return null;
        }
        var minor = parts.Length > 1 && int.TryParse(parts[1], out var parsedMinor) ? parsedMinor : 0;
        return $"{major}.{minor}";
    }

    private sealed record EfAssembly(string Name, Version Version, string Path);
}
