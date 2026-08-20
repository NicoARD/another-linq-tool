var cutoff = DateTime.UtcNow.AddDays(-30);

var orders = Enumerable.Range(1, 5)
    .Select(i => new { Id = i, Total = i * 10.5m, CreatedAt = cutoff.AddDays(i) })
    .ToList();

var total = orders.Sum(o => o.Total);

new
{
    Count = orders.Count,
    Total = total,
    First = orders.First().CreatedAt,
}
