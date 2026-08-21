using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using LinqRunner.Results;

namespace LinqRunner.Data;

/// <summary>
/// Observes EF Core's database-command diagnostic events for one script execution. This keeps the
/// runner independent from the application's EF Core assembly (which can be a different version),
/// while observing the same database command lifecycle exposed to command interceptors.
/// </summary>
public sealed class EfCoreCommandCapture : IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
{
    private const string EfCoreDiagnosticSource = "Microsoft.EntityFrameworkCore";
    private const string CommandEventPrefix = "Microsoft.EntityFrameworkCore.Database.Command.";

    private readonly object gate = new();
    private readonly List<SqlCommandInfo> commands = [];
    private readonly Dictionary<Guid, PendingCommand> pending = [];
    private readonly HashSet<int> assignedOrders = [];
    private readonly IDisposable allListenersSubscription;
    private IDisposable? efCoreSubscription;

    public EfCoreCommandCapture() => allListenersSubscription = DiagnosticListener.AllListeners.Subscribe(this);

    /// <summary>Marks the start of value serialization, which may enumerate an EF query.</summary>
    public int BeginScope()
    {
        lock (gate)
        {
            return commands.Count;
        }
    }

    /// <summary>Returns commands caused by the marked serialization and prevents them appearing again globally.</summary>
    public IReadOnlyList<SqlCommandInfo> CompleteScope(int start)
    {
        lock (gate)
        {
            var captured = commands.Skip(start).ToList();
            foreach (var command in captured)
            {
                assignedOrders.Add(command.Order);
            }

            return captured;
        }
    }

    /// <summary>Returns commands not already attached to a specific dump.</summary>
    public IReadOnlyList<SqlCommandInfo> TakeUnassignedCommands()
    {
        lock (gate)
        {
            return commands.Where(command => !assignedOrders.Contains(command.Order)).ToList();
        }
    }

    public void OnNext(DiagnosticListener listener)
    {
        if (listener.Name == EfCoreDiagnosticSource && efCoreSubscription is null)
        {
            efCoreSubscription = listener.Subscribe(this, IsCommandEvent);
        }
    }

    public void OnNext(KeyValuePair<string, object?> value)
    {
        var eventData = value.Value;
        if (eventData is null)
        {
            return;
        }

        var commandId = Read<Guid>(eventData, "CommandId");
        if (commandId == Guid.Empty)
        {
            return;
        }

        switch (value.Key)
        {
            case CommandEventPrefix + "CommandExecuting":
                RecordStart(commandId, Read<DbCommand>(eventData, "Command"));
                break;
            case CommandEventPrefix + "CommandExecuted":
                RecordCompletion(commandId, true, Read<TimeSpan?>(eventData, "Duration"), null);
                break;
            case CommandEventPrefix + "CommandError":
                RecordCompletion(commandId, false, Read<TimeSpan?>(eventData, "Duration"), Read<Exception>(eventData, "Exception")?.Message);
                break;
        }
    }

    public void OnError(Exception _) { }
    public void OnCompleted() { }

    public void Dispose()
    {
        efCoreSubscription?.Dispose();
        allListenersSubscription.Dispose();
    }

    private static bool IsCommandEvent(string name) =>
        name is CommandEventPrefix + "CommandExecuting" or CommandEventPrefix + "CommandExecuted" or CommandEventPrefix + "CommandError";

    private void RecordStart(Guid commandId, DbCommand? command)
    {
        if (command is null)
        {
            return;
        }

        lock (gate)
        {
            var info = new SqlCommandInfo
            {
                Order = commands.Count + 1,
                Text = command.CommandText,
                CommandType = command.CommandType.ToString(),
                Parameters = command.Parameters.Cast<DbParameter>().Select(MapParameter).ToList(),
            };
            commands.Add(info);
            pending[commandId] = new PendingCommand(info, Stopwatch.GetTimestamp());
        }
    }

    private void RecordCompletion(Guid commandId, bool succeeded, TimeSpan? duration, string? error)
    {
        lock (gate)
        {
            if (!pending.Remove(commandId, out var started))
            {
                return;
            }

            started.Info.Succeeded = succeeded;
            started.Info.Error = error;
            started.Info.ElapsedMs = duration.HasValue
                ? (long)Math.Round(duration.Value.TotalMilliseconds)
                : (long)Math.Round(Stopwatch.GetElapsedTime(started.StartTimestamp).TotalMilliseconds);
        }
    }

    private static SqlParameterInfo MapParameter(DbParameter parameter) => new()
    {
        Name = parameter.ParameterName,
        Value = FormatValue(parameter.Value),
        DbType = parameter.DbType.ToString(),
        Direction = parameter.Direction.ToString(),
    };

    private static string? FormatValue(object? value) => value switch
    {
        null or DBNull => "NULL",
        string text => $"'{text.Replace("'", "''")}'",
        char character => $"'{character.ToString().Replace("'", "''")}'",
        DateTime dateTime => dateTime.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O", CultureInfo.InvariantCulture),
        byte[] bytes => $"0x{Convert.ToHexString(bytes)}",
        _ => Convert.ToString(value, CultureInfo.InvariantCulture),
    };

    private static T? Read<T>(object source, string propertyName)
    {
        var value = source.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public)?.GetValue(source);
        return value is T typed ? typed : default;
    }

    private sealed record PendingCommand(SqlCommandInfo Info, long StartTimestamp);
}
