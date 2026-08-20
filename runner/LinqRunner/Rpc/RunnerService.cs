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
        ScriptExecutor.ExecuteAsync(parameters.Source ?? string.Empty, parameters.RowLimit ?? 1000, cancellationToken);

    [JsonRpcMethod("shutdown")]
    public void Shutdown() => _ = Task.Run(async () =>
    {
        await Task.Delay(50);
        Environment.Exit(0);
    });
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
}
