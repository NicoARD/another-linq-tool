using LinqRunner.Rpc;
using LinqRunner.Scripting;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

// Two entry modes:
//   1. `LinqRunner execute <file> [--limit N]`  -> run a script file, print JSON result (for CLI/testing)
//   2. `LinqRunner`                             -> speak JSON-RPC over stdio (used by the VS Code extension)

if (args.Length > 0 && args[0].Equals("execute", StringComparison.OrdinalIgnoreCase))
{
    return await Cli.RunAsync(args.Skip(1).ToArray());
}

await RpcHost.RunAsync();
return 0;

static class Cli
{
    static readonly JsonSerializerSettings JsonSettings = new()
    {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        NullValueHandling = NullValueHandling.Ignore,
        Formatting = Formatting.Indented,
    };

    public static async Task<int> RunAsync(string[] args)
    {
        var file = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal));
        if (file is null || !File.Exists(file))
        {
            await Console.Error.WriteLineAsync($"Script file not found: {file}");
            return 2;
        }

        var rowLimit = 1000;
        var limitIndex = Array.IndexOf(args, "--limit");
        if (limitIndex >= 0 && limitIndex + 1 < args.Length && int.TryParse(args[limitIndex + 1], out var parsed))
        {
            rowLimit = parsed;
        }

        var source = await File.ReadAllTextAsync(file);
        var result = await ScriptExecutor.ExecuteAsync(source, rowLimit, CancellationToken.None);

        Console.WriteLine(JsonConvert.SerializeObject(result, JsonSettings));
        return result.Status == "success" ? 0 : 1;
    }
}
