namespace LinqRunner.Api;

/// <summary>Invokes the parameterless Main method used by LINQPad Program queries.</summary>
public static class ProgramEntryPoint
{
    public static Task<object?> InvokeAsync(Action entryPoint)
    {
        entryPoint();
        return Task.FromResult<object?>(null);
    }

    public static Task<object?> InvokeAsync<T>(Func<T> entryPoint) =>
        Task.FromResult<object?>(entryPoint());

    public static async Task<object?> InvokeAsync(Func<Task> entryPoint)
    {
        await entryPoint();
        return null;
    }

    public static async Task<object?> InvokeAsync<T>(Func<Task<T>> entryPoint) =>
        await entryPoint();

    public static async Task<object?> InvokeAsync(Func<ValueTask> entryPoint)
    {
        await entryPoint();
        return null;
    }

    public static async Task<object?> InvokeAsync<T>(Func<ValueTask<T>> entryPoint) =>
        await entryPoint();
}
