using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace LinqRunner.Nuget;

/// <summary>
/// Resolves NuGet packages by generating a tiny SDK project and running <c>dotnet build</c>, then
/// returning the resulting assembly paths. This delegates all restore/version/transitive/feed logic to
/// the real .NET toolchain (no custom resolver). Results are cached per package set; the global NuGet
/// cache makes repeat restores fast.
/// </summary>
public static class NuGetResolver
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly Dictionary<string, string> OutputByKey = new(StringComparer.Ordinal);

    public static async Task<IReadOnlyList<string>> RestoreAsync(
        IReadOnlyList<string> packages,
        string targetFramework,
        CancellationToken cancellationToken)
    {
        if (packages.Count == 0)
        {
            return [];
        }

        var key = targetFramework + ";" + string.Join(";", packages.Select(NormalizePackage).OrderBy(p => p, StringComparer.OrdinalIgnoreCase));

        await Gate.WaitAsync(cancellationToken);
        try
        {
            if (!OutputByKey.TryGetValue(key, out var outputDir) || !Directory.Exists(outputDir))
            {
                outputDir = await BuildAsync(key, packages, targetFramework, cancellationToken);
                OutputByKey[key] = outputDir;
            }

            var projectAssembly = Path.Combine(outputDir, "LinqPackages.dll");
            return Directory.EnumerateFiles(outputDir, "*.dll")
                .Where(p => !string.Equals(p, projectAssembly, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }
        finally
        {
            Gate.Release();
        }
    }

    private static async Task<string> BuildAsync(
        string key,
        IReadOnlyList<string> packages,
        string targetFramework,
        CancellationToken cancellationToken)
    {
        var projectDir = Path.Combine(Path.GetTempPath(), "linqrunner-nuget", ShortHash(key));
        Directory.CreateDirectory(projectDir);

        var references = string.Join(
            Environment.NewLine,
            packages.Select(ToPackageReference));

        var csproj = $"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>{targetFramework}</TargetFramework>
                <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
                <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
                <Nullable>disable</Nullable>
              </PropertyGroup>
              <ItemGroup>
            {references}
              </ItemGroup>
            </Project>
            """;

        var projectPath = Path.Combine(projectDir, "LinqPackages.csproj");
        await File.WriteAllTextAsync(projectPath, csproj, cancellationToken);

        var startInfo = new ProcessStartInfo("dotnet", $"build \"{projectPath}\" -c Release --nologo -v quiet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = projectDir,
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Could not start 'dotnet' to restore packages.");

        var stdout = await process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = await process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                "Package restore failed:" + Environment.NewLine + stdout + stderr);
        }

        return Path.Combine(projectDir, "bin", "Release", targetFramework);
    }

    private static string ToPackageReference(string package)
    {
        var (id, version) = ParsePackage(package);
        return $"""    <PackageReference Include="{id}" Version="{version}" />""";
    }

    private static string NormalizePackage(string package)
    {
        var (id, version) = ParsePackage(package);
        return $"{id}@{version}";
    }

    // "Dapper@2.1.66" | "Dapper" | "Humanizer@2.x" -> (id, floatable version)
    private static (string Id, string Version) ParsePackage(string package)
    {
        var parts = package.Split('@', 2, StringSplitOptions.TrimEntries);
        var id = parts[0];
        var version = parts.Length > 1 && parts[1].Length > 0 ? parts[1].Replace('x', '*') : "*";
        return (id, version);
    }

    private static string ShortHash(string value)
    {
        var bytes = SHA1.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes)[..12];
    }
}
