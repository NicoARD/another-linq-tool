using System.Reflection;
using LinqRunner.Loading;

namespace LinqRunner.Data;

/// <summary>Everything needed to construct the user's DbContext for one execution.</summary>
public sealed class DbContextRequest
{
    public string? Context { get; init; }            // full type name of the DbContext
    public string? Provider { get; init; }           // "sqlite" | "sqlserver"
    public string? ConnectionString { get; init; }
    public string? FactoryType { get; init; }        // optional custom factory type
    public string? FactoryMethod { get; init; }      // factory method name (default "Create")
    public string? EfCoreVersion { get; init; }      // optional profile override for provider resolution

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Context) || !string.IsNullOrWhiteSpace(FactoryType);
}

/// <summary>
/// Constructs the user's DbContext by reflecting over the application's OWN loaded EF Core assemblies
/// (never a copy referenced by the runner), which keeps assembly identity/version consistent with the
/// user's DbContext. Supports two modes:
///  - standard: build <c>DbContextOptions&lt;TContext&gt;</c> via the provider (UseSqlite/UseSqlServer)
///              and invoke the <c>DbContextOptions</c> constructor.
///  - factory:  invoke a user-provided factory method (<c>Create(string connectionString)</c> or no-arg).
/// </summary>
public static class DbContextBuilder
{
    public static object Create(DbContextRequest request, IReadOnlyList<Assembly> loadedAssemblies)
    {
        return !string.IsNullOrWhiteSpace(request.FactoryType)
            ? CreateFromFactory(request, loadedAssemblies)
            : CreateStandard(request, loadedAssemblies);
    }

    private static object CreateStandard(DbContextRequest request, IReadOnlyList<Assembly> loadedAssemblies)
    {
        var contextType = FindType(request.Context!, loadedAssemblies)
            ?? throw new InvalidOperationException(
                $"DbContext type '{request.Context}' was not found in the configured assemblies.");

        var efCore = RequireAssembly("Microsoft.EntityFrameworkCore");
        var builderOpenType = efCore.GetType("Microsoft.EntityFrameworkCore.DbContextOptionsBuilder`1")
            ?? throw new InvalidOperationException("Could not locate DbContextOptionsBuilder<> in the loaded EF Core.");
        var builderType = builderOpenType.MakeGenericType(contextType);
        var builder = Activator.CreateInstance(builderType)!;

        ApplyProvider(builder, request);

        // DbContextOptionsBuilder<T> shadows the base "Options" property, so restrict to the declared one
        // (it returns the generic DbContextOptions<T> the context constructor expects).
        var optionsProperty = builderType.GetProperty(
            "Options",
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            ?? throw new InvalidOperationException("Could not read Options from DbContextOptionsBuilder<>.");
        var options = optionsProperty.GetValue(builder)!;

        var constructor = contextType.GetConstructors()
            .FirstOrDefault(c =>
            {
                var parameters = c.GetParameters();
                return parameters.Length == 1 && parameters[0].ParameterType.IsInstanceOfType(options);
            })
            ?? throw new InvalidOperationException(
                $"'{contextType.Name}' has no constructor accepting DbContextOptions. Configure a contextFactory instead.");

        return constructor.Invoke([options]);
    }

    private static void ApplyProvider(object optionsBuilder, DbContextRequest request)
    {
        var provider = (request.Provider ?? string.Empty).ToLowerInvariant();
        var (assemblyName, extensionsType, methodName) = provider switch
        {
            "sqlite" => (
                "Microsoft.EntityFrameworkCore.Sqlite",
                "Microsoft.EntityFrameworkCore.SqliteDbContextOptionsBuilderExtensions",
                "UseSqlite"),
            "sqlserver" => (
                "Microsoft.EntityFrameworkCore.SqlServer",
                "Microsoft.EntityFrameworkCore.SqlServerDbContextOptionsExtensions",
                "UseSqlServer"),
            _ => throw new InvalidOperationException(
                $"Unsupported provider '{request.Provider}'. Supported: 'sqlite', 'sqlserver'."),
        };

        var providerAssembly = RequireAssembly(assemblyName);
        var extensions = providerAssembly.GetType(extensionsType)
            ?? throw new InvalidOperationException($"Provider extension type '{extensionsType}' not found.");

        var optionsBuilderBase = RequireAssembly("Microsoft.EntityFrameworkCore")
            .GetType("Microsoft.EntityFrameworkCore.DbContextOptionsBuilder")!;

        // Prefer the non-generic overload: Use{Provider}(DbContextOptionsBuilder, string, [Action]).
        var method = extensions.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Where(m => m.Name == methodName && !m.IsGenericMethod)
            .Select(m => new { Method = m, Parameters = m.GetParameters() })
            .Where(x => x.Parameters.Length >= 2
                && x.Parameters[0].ParameterType == optionsBuilderBase
                && x.Parameters[1].ParameterType == typeof(string))
            .OrderBy(x => x.Parameters.Length)
            .Select(x => x.Method)
            .FirstOrDefault()
            ?? throw new InvalidOperationException($"Could not find {methodName}(DbContextOptionsBuilder, string).");

        var parameters = method.GetParameters();
        var arguments = new object?[parameters.Length];
        arguments[0] = optionsBuilder;
        arguments[1] = request.ConnectionString ?? string.Empty;
        for (var i = 2; i < parameters.Length; i++)
        {
            arguments[i] = parameters[i].HasDefaultValue ? parameters[i].DefaultValue : null;
        }

        method.Invoke(null, arguments);
    }

    private static object CreateFromFactory(DbContextRequest request, IReadOnlyList<Assembly> loadedAssemblies)
    {
        var factoryType = FindType(request.FactoryType!, loadedAssemblies)
            ?? throw new InvalidOperationException($"Factory type '{request.FactoryType}' was not found.");

        var methodName = string.IsNullOrWhiteSpace(request.FactoryMethod) ? "Create" : request.FactoryMethod!;
        var method = factoryType.GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)
            ?? throw new InvalidOperationException($"Factory method '{factoryType.Name}.{methodName}' was not found.");

        var target = method.IsStatic ? null : Activator.CreateInstance(factoryType);
        var parameters = method.GetParameters();

        var result = parameters.Length == 1 && parameters[0].ParameterType == typeof(string)
            ? method.Invoke(target, [request.ConnectionString])
            : method.Invoke(target, null);

        return result
            ?? throw new InvalidOperationException($"Factory '{factoryType.Name}.{methodName}' returned null.");
    }

    private static Type? FindType(string fullName, IReadOnlyList<Assembly> loadedAssemblies)
    {
        return UserAssemblyLoader.ResolveType(fullName, loadedAssemblies);
    }

    private static Assembly RequireAssembly(string simpleName)
    {
        return UserAssemblyLoader.LoadByName(simpleName)
            ?? throw new InvalidOperationException(
                $"Required assembly '{simpleName}' is not available beside your application DLLs. " +
                "Ensure the app's output folder (with its dependencies) is referenced.");
    }
}
