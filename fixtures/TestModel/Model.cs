namespace TestModel;

public class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; }
}

public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
}

/// <summary>Stand-in for an application's data surface until the EF Core DbContext step (next milestone).</summary>
public static class SampleData
{
    public static IReadOnlyList<Customer> Customers { get; } =
    [
        new() { Id = 1, Name = "Ada", IsActive = true },
        new() { Id = 2, Name = "Alan", IsActive = false },
        new() { Id = 3, Name = "Grace", IsActive = true },
    ];

    public static IReadOnlyList<Product> Products { get; } =
    [
        new() { Id = 1, Name = "Widget", Price = 9.99m },
        new() { Id = 2, Name = "Gadget", Price = 19.95m },
    ];
}
