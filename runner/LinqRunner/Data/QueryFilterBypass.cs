using System.Linq.Expressions;
using System.Reflection;

namespace LinqRunner.Data;

/// <summary>
/// Makes read queries executed through the DbContext behave as if every query called
/// <c>IgnoreQueryFilters()</c>, while leaving change-tracking writes (Add/Update/Remove) untouched.
/// EF Core has no built-in global switch for this, so we register an
/// <c>IQueryExpressionInterceptor</c> (EF Core 8+) that rewrites each query's roots. All types are
/// resolved from the user's own loaded EF Core assembly to preserve assembly identity.
/// </summary>
internal static class QueryFilterBypass
{
    public static void Apply(object optionsBuilder, Assembly efCore)
    {
        var interceptorInterface = efCore.GetType("Microsoft.EntityFrameworkCore.Diagnostics.IQueryExpressionInterceptor")
            ?? throw new InvalidOperationException(
                "Bypassing query filters requires EF Core 8 or newer (IQueryExpressionInterceptor was not found).");
        var interceptorBase = efCore.GetType("Microsoft.EntityFrameworkCore.Diagnostics.IInterceptor")
            ?? throw new InvalidOperationException("Could not locate IInterceptor in the loaded EF Core.");

        var ignoreQueryFilters = FindIgnoreQueryFilters(efCore);

        // DispatchProxy.Create<TInterface, TProxy>() builds a type implementing the runtime-only interface.
        var createMethod = typeof(DispatchProxy).GetMethods(BindingFlags.Public | BindingFlags.Static)
            .FirstOrDefault(m => m.Name == nameof(DispatchProxy.Create)
                && m.IsGenericMethodDefinition
                && m.GetGenericArguments().Length == 2
                && m.GetParameters().Length == 0)
            ?? throw new InvalidOperationException("Could not locate DispatchProxy.Create<T, TProxy>().");
        var proxy = (QueryExpressionProxy)createMethod
            .MakeGenericMethod(interceptorInterface, typeof(QueryExpressionProxy))
            .Invoke(null, null)!;
        proxy.Rewrite = expression => new QueryRootRewriter(ignoreQueryFilters).Visit(expression);

        var interceptors = Array.CreateInstance(interceptorBase, 1);
        interceptors.SetValue(proxy, 0);

        // Prefer the params overload: AddInterceptors(params IInterceptor[]).
        var addInterceptors = optionsBuilder.GetType().GetMethods()
            .FirstOrDefault(m => m.Name == "AddInterceptors"
                && m.GetParameters() is { Length: 1 } parameters
                && parameters[0].ParameterType.IsArray)
            ?? throw new InvalidOperationException("Could not find DbContextOptionsBuilder.AddInterceptors(IInterceptor[]).");
        addInterceptors.Invoke(optionsBuilder, [interceptors]);
    }

    private static MethodInfo FindIgnoreQueryFilters(Assembly efCore)
    {
        var extensions = efCore.GetType("Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions")
            ?? throw new InvalidOperationException("Could not locate EntityFrameworkQueryableExtensions in the loaded EF Core.");

        // The single-parameter overload ignores ALL filters; newer overloads that take filter keys are skipped.
        return extensions.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .FirstOrDefault(m => m.Name == "IgnoreQueryFilters"
                && m.IsGenericMethodDefinition
                && m.GetParameters().Length == 1)
            ?? throw new InvalidOperationException("Could not find IgnoreQueryFilters(IQueryable<T>) in the loaded EF Core.");
    }

    /// <summary>DispatchProxy implementation for the runtime-only IQueryExpressionInterceptor interface.</summary>
    public class QueryExpressionProxy : DispatchProxy
    {
        public Func<Expression, Expression> Rewrite { get; set; } = static expression => expression;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            // IQueryExpressionInterceptor.QueryCompilationStarting(Expression, QueryExpressionEventData) => Expression
            if (targetMethod?.Name == "QueryCompilationStarting" && args is [Expression expression, _])
            {
                return Rewrite(expression);
            }
            return targetMethod?.ReturnType == typeof(void) || args is not { Length: > 0 } ? null : args[0];
        }
    }

    /// <summary>Wraps every EF query-root leaf with a call to <c>IgnoreQueryFilters()</c>.</summary>
    private sealed class QueryRootRewriter(MethodInfo ignoreQueryFiltersOpen) : ExpressionVisitor
    {
        protected override Expression VisitExtension(Expression node)
        {
            if (node.GetType().Name is "QueryRootExpression" or "EntityQueryRootExpression")
            {
                var elementType = QueryableElementType(node.Type);
                if (elementType is not null)
                {
                    var ignore = ignoreQueryFiltersOpen.MakeGenericMethod(elementType);
                    return Expression.Call(ignore, node);
                }
            }
            return base.VisitExtension(node);
        }

        private static Type? QueryableElementType(Type type)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IQueryable<>))
            {
                return type.GetGenericArguments()[0];
            }
            return type.GetInterfaces()
                .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IQueryable<>))
                ?.GetGenericArguments()[0];
        }
    }
}
