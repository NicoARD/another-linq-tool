<Query Kind="Program">
  <Namespace>System</Namespace>
  <Namespace>System.Collections.Generic</Namespace>
  <Namespace>System.Linq</Namespace>
</Query>

async Task<List<string>> Main()
{
    await Task.Delay(10);
    return Enumerable.Range(1, 5)
        .Where(number => number % 2 == 1)
        .Select(Formatter.Format)
        .ToList();
}

static class Formatter
{
    public static string Format(int number) => $"Item {number}";
}
