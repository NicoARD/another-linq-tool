using System.Reflection;
using LinqRunner.Data;
using LinqRunner.Loading;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace LinqRunner.Scripting;

/// <summary>Provides side-effect-free semantic completion for the editor.</summary>
public static class ScriptCompletionService
{
    public static async Task<CompletionResult> CompleteAsync(
        string source,
        int position,
        IReadOnlyList<string> assemblies,
        IReadOnlyList<string> imports,
        IReadOnlyList<string> packages,
        DbContextRequest dbRequest,
        bool namespacesOnly,
        CancellationToken cancellationToken)
    {
        try
        {
            // Namespace discovery only needs the profile's reference graph. Do not parse the editor text
            // in that mode because the user may currently be typing an incomplete XML/directive header.
            var document = ScriptDocument.Parse(namespacesOnly ? string.Empty : source);
            var effectivePackages = EfCoreDependencyPolicy.PreparePackages(packages, assemblies, dbRequest);
            var effectiveAssemblies = assemblies;
            if (effectivePackages.Count > 0)
            {
                var packageAssemblies = await Nuget.NuGetResolver.RestoreAsync(
                    effectivePackages,
                    $"net{Environment.Version.Major}.0",
                    cancellationToken);
                effectiveAssemblies = [.. assemblies, .. packageAssemblies];
            }

            EfCoreDependencyPolicy.Validate(effectiveAssemblies, dbRequest);

            var loaded = UserAssemblyLoader.Load(effectiveAssemblies);
            var globalsType = ResolveGlobalsType(dbRequest, loaded.Assemblies);
            var effectiveImports = imports
                .Concat(document.Namespaces)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (globalsType is not null && !effectiveImports.Contains("Microsoft.EntityFrameworkCore"))
            {
                effectiveImports.Add("Microsoft.EntityFrameworkCore");
            }

            var options = ScriptOptions.Default
                .WithReferences(FrameworkReferences.Value)
                .AddReferences(typeof(Api.DumpExtensions).Assembly)
                .AddReferences(loaded.References)
                .WithImports(ScriptExecutor.DefaultImports.Concat(effectiveImports));

            var script = CSharpScript.Create<object>(document.Source, options, globalsType);
            var compilation = script.GetCompilation();

            if (namespacesOnly)
            {
                var namespaces = new List<CompletionEntry>();
                AddNamespaces(compilation.GlobalNamespace, string.Empty, namespaces, cancellationToken);
                return new CompletionResult { Items = namespaces };
            }

            var tree = compilation.SyntaxTrees.Last();
            var root = await tree.GetRootAsync(cancellationToken);
            position = Math.Clamp(position, 0, tree.Length);
            var model = compilation.GetSemanticModel(tree);
            var memberAccess = FindMemberAccess(root, position);

            IEnumerable<ISymbol> symbols;
            if (memberAccess is not null)
            {
                var type = model.GetTypeInfo(memberAccess.Expression, cancellationToken).Type;
                symbols = type is null
                    ? []
                    : model.LookupSymbols(position, container: type, includeReducedExtensionMethods: true);
            }
            else
            {
                symbols = model.LookupSymbols(position);
            }

            var items = symbols
                .Where(symbol => symbol.CanBeReferencedByName && !symbol.IsImplicitlyDeclared)
                .Select(ToEntry)
                .GroupBy(item => (item.Label, item.Kind), StringTupleComparer.Instance)
                .Select(group => group.First())
                .OrderBy(item => item.Label, StringComparer.OrdinalIgnoreCase)
                .Take(2000)
                .ToList();
            return new CompletionResult { Items = items };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new CompletionResult { Error = ex.InnerException?.Message ?? ex.Message };
        }
    }

    private static MemberAccessExpressionSyntax? FindMemberAccess(SyntaxNode root, int position)
    {
        if (root.FullSpan.IsEmpty)
        {
            return null;
        }

        var lookupPosition = Math.Clamp(position == 0 ? 0 : position - 1, 0, root.FullSpan.End - 1);
        return root.FindToken(lookupPosition).Parent?.AncestorsAndSelf()
            .OfType<MemberAccessExpressionSyntax>()
            .FirstOrDefault(access => position >= access.OperatorToken.Span.End);
    }

    private static Type? ResolveContextType(DbContextRequest request, IReadOnlyList<Assembly> assemblies)
    {
        if (!string.IsNullOrWhiteSpace(request.Context))
        {
            return UserAssemblyLoader.ResolveType(request.Context, assemblies);
        }

        if (string.IsNullOrWhiteSpace(request.FactoryType))
        {
            return null;
        }

        var factory = UserAssemblyLoader.ResolveType(request.FactoryType, assemblies);
        var methodName = string.IsNullOrWhiteSpace(request.FactoryMethod) ? "Create" : request.FactoryMethod;
        return factory?.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)
            .FirstOrDefault(method => method.Name == methodName)?.ReturnType;
    }

    private static Type? ResolveGlobalsType(DbContextRequest request, IReadOnlyList<Assembly> assemblies)
    {
        var contextType = ResolveContextType(request, assemblies);
        return contextType is null ? null : typeof(Api.ScriptGlobals<>).MakeGenericType(contextType);
    }

    private static CompletionEntry ToEntry(ISymbol symbol) => new()
    {
        Label = symbol.Name,
        Kind = symbol.Kind switch
        {
            SymbolKind.Namespace => "namespace",
            SymbolKind.NamedType when ((INamedTypeSymbol)symbol).TypeKind == TypeKind.Interface => "interface",
            SymbolKind.NamedType when ((INamedTypeSymbol)symbol).TypeKind == TypeKind.Enum => "enum",
            SymbolKind.NamedType when ((INamedTypeSymbol)symbol).TypeKind == TypeKind.Struct => "struct",
            SymbolKind.NamedType => "class",
            SymbolKind.Method => "method",
            SymbolKind.Property => "property",
            SymbolKind.Field => "field",
            SymbolKind.Event => "event",
            SymbolKind.Parameter => "variable",
            SymbolKind.Local => "variable",
            _ => "value",
        },
        Detail = symbol.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat),
    };

    private static void AddNamespaces(
        INamespaceSymbol symbol,
        string prefix,
        List<CompletionEntry> result,
        CancellationToken cancellationToken)
    {
        foreach (var child in symbol.GetNamespaceMembers())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var name = string.IsNullOrEmpty(prefix) ? child.Name : $"{prefix}.{child.Name}";
            result.Add(new CompletionEntry { Label = name, Kind = "namespace", Detail = "namespace" });
            AddNamespaces(child, name, result, cancellationToken);
        }
    }

    private sealed class StringTupleComparer : IEqualityComparer<(string Label, string Kind)>
    {
        public static readonly StringTupleComparer Instance = new();

        public bool Equals((string Label, string Kind) x, (string Label, string Kind) y) =>
            StringComparer.Ordinal.Equals(x.Label, y.Label) && StringComparer.Ordinal.Equals(x.Kind, y.Kind);

        public int GetHashCode((string Label, string Kind) value) =>
            HashCode.Combine(StringComparer.Ordinal.GetHashCode(value.Label), StringComparer.Ordinal.GetHashCode(value.Kind));
    }
}

public sealed class CompletionResult
{
    public List<CompletionEntry> Items { get; init; } = [];
    public string? Error { get; init; }
}

public sealed class CompletionEntry
{
    public string Label { get; init; } = string.Empty;
    public string Kind { get; init; } = "value";
    public string? Detail { get; init; }
}
