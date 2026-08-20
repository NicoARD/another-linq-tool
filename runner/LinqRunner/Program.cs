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

        var assemblies = CollectOption(args, "--assembly");
        var imports = CollectOption(args, "--import");
        var packages = CollectOption(args, "--package");

        var dbRequest = new LinqRunner.Data.DbContextRequest
        {
            Context = SingleOption(args, "--context"),
            Provider = SingleOption(args, "--provider"),
            ConnectionString = SingleOption(args, "--connection"),
            FactoryType = SingleOption(args, "--factory-type"),
            FactoryMethod = SingleOption(args, "--factory-method"),
        };

        var source = await File.ReadAllTextAsync(file);
        var result = await ScriptExecutor.ExecuteAsync(source, rowLimit, assemblies, imports, packages, dbRequest, CancellationToken.None);

        Console.WriteLine(JsonConvert.SerializeObject(result, JsonSettings));
        return result.Status == "success" ? 0 : 1;
    }

    // Returns the value following the given option, or null if absent.
    static string? SingleOption(string[] args, string option)
    {
        var index = Array.IndexOf(args, option);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    // Collects all values of a repeatable option, e.g. `--assembly a.dll --assembly b.dll`.
    static List<string> CollectOption(string[] args, string option)
    {
        var values = new List<string>();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(option, StringComparison.Ordinal))
            {
                values.Add(args[i + 1]);
            }
        }

        return values;
    }
}
