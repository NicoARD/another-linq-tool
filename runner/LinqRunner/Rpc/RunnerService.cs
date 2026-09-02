using LinqRunner.Results;
using LinqRunner.Scripting;
using Newtonsoft.Json.Serialization;
using StreamJsonRpc;

namespace LinqRunner.Rpc;

/// <summary>Hosts the JSON-RPC endpoint over stdio (stdout = outbound, stdin = inbound).</summary>
public static class RpcHost
{
    public static async Task RunAsync()
    {
        var formatter = new JsonMessageFormatter();
        formatter.JsonSerializer.ContractResolver = new CamelCasePropertyNamesContractResolver();

        var handler = new HeaderDelimitedMessageHandler(
            Console.OpenStandardOutput(),
            Console.OpenStandardInput(),
            formatter);

        var rpc = new JsonRpc(handler);
        rpc.AddLocalRpcTarget(new RunnerService(), null);
        rpc.StartListening();

        await Console.Error.WriteLineAsync("[LinqRunner] JSON-RPC runner ready.");
        await rpc.Completion;
    }
}

/// <summary>JSON-RPC surface. Method names are the versioned protocol verbs.</summary>
public sealed class RunnerService
{
    public const int ProtocolVersion = 1;

    [JsonRpcMethod("initialize", UseSingleObjectParameterDeserialization = true)]
    public InitializeResult Initialize(InitializeParams _) => new()
    {
        ProtocolVersion = ProtocolVersion,
        Runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
    };

    [JsonRpcMethod("ping")]
    public string Ping() => "pong";

    [JsonRpcMethod("execute", UseSingleObjectParameterDeserialization = true)]
    public Task<ExecuteResult> Execute(ExecuteParams parameters, CancellationToken cancellationToken) =>
        ScriptExecutor.ExecuteAsync(
            parameters.Source ?? string.Empty,
            parameters.RowLimit ?? 1000,
            parameters.Assemblies ?? [],
            parameters.Imports ?? [],
            parameters.Packages ?? [],
            new Data.DbContextRequest
            {
                Context = parameters.Context,
                Provider = parameters.Provider,
                ConnectionString = parameters.ConnectionString,
                FactoryType = parameters.ContextFactoryType,
                FactoryMethod = parameters.ContextFactoryMethod,
                EfCoreVersion = parameters.EfCoreVersion,
            },
            cancellationToken,
            parameters.DebugSourcePath,
            parameters.DebugSourceOffset,
            parameters.DebugSourceChecksum);

    [JsonRpcMethod("complete", UseSingleObjectParameterDeserialization = true)]
    public Task<CompletionResult> Complete(CompleteParams parameters, CancellationToken cancellationToken) =>
        ScriptCompletionService.CompleteAsync(
            parameters.Source ?? string.Empty,
            parameters.Position,
            parameters.Assemblies ?? [],
            parameters.Imports ?? [],
            parameters.Packages ?? [],
            new Data.DbContextRequest
            {
                Context = parameters.Context,
                Provider = parameters.Provider,
                FactoryType = parameters.ContextFactoryType,
                FactoryMethod = parameters.ContextFactoryMethod,
                EfCoreVersion = parameters.EfCoreVersion,
            },
            parameters.NamespacesOnly,
            cancellationToken);

    [JsonRpcMethod("shutdown")]
    public void Shutdown() => _ = Task.Run(async () =>
    {
        await Task.Delay(50);
        Environment.Exit(0);
    });

    [JsonRpcMethod("discoverContexts", UseSingleObjectParameterDeserialization = true)]
    public DiscoverContextsResult DiscoverContexts(DiscoverContextsParams parameters)
    {
        try
        {
            var contexts = Data.ContextDiscovery.Discover(parameters.Assemblies ?? []);
            return new DiscoverContextsResult { Contexts = [.. contexts] };
        }
        catch (Exception ex)
        {
            return new DiscoverContextsResult { Contexts = [], Error = ex.Message };
        }
    }
}

public sealed class InitializeParams
{
    public int ClientProtocolVersion { get; set; }
}

public sealed class InitializeResult
{
    public int ProtocolVersion { get; set; }
    public string? Runtime { get; set; }
}

public sealed class ExecuteParams
{
    public string? Source { get; set; }
    public int? RowLimit { get; set; }
    public string[]? Assemblies { get; set; }
    public string[]? Imports { get; set; }
    public string[]? Packages { get; set; }
    public string? Context { get; set; }
    public string? Provider { get; set; }
    public string? ConnectionString { get; set; }
    public string? ContextFactoryType { get; set; }
    public string? ContextFactoryMethod { get; set; }
    public string? EfCoreVersion { get; set; }
    public string? DebugSourcePath { get; set; }
    public int DebugSourceOffset { get; set; }
    public string? DebugSourceChecksum { get; set; }
}

public sealed class CompleteParams
{
    public string? Source { get; set; }
    public int Position { get; set; }
    public string[]? Assemblies { get; set; }
    public string[]? Imports { get; set; }
    public string[]? Packages { get; set; }
    public string? Context { get; set; }
    public string? Provider { get; set; }
    public string? ContextFactoryType { get; set; }
    public string? ContextFactoryMethod { get; set; }
    public string? EfCoreVersion { get; set; }
    public bool NamespacesOnly { get; set; }
}

public sealed class DiscoverContextsParams
{
    public string[]? Assemblies { get; set; }
}

public sealed class DiscoverContextsResult
{
    public string[] Contexts { get; set; } = [];
    public string? Error { get; set; }
}
