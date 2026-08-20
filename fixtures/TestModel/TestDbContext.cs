using Microsoft.EntityFrameworkCore;

namespace TestModel;

/// <summary>
/// A realistic application DbContext used to exercise the runner's DbContext construction.
/// Standard EF Core shape: a single <see cref="DbContextOptions{TContext}"/> constructor.
/// Seed data is applied via HasData so <c>Db.Database.EnsureCreated()</c> populates a fresh database.
/// </summary>
public class TestDbContext : DbContext
{
    public TestDbContext(DbContextOptions<TestDbContext> options)
        : base(options)
    {
    }

    public DbSet<Customer> Customers => Set<Customer>();

    public DbSet<Product> Products => Set<Product>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Customer>().HasData(
            new Customer { Id = 1, Name = "Ada", IsActive = true },
            new Customer { Id = 2, Name = "Alan", IsActive = false },
            new Customer { Id = 3, Name = "Grace", IsActive = true });

        modelBuilder.Entity<Product>().HasData(
            new Product { Id = 1, Name = "Widget", Price = 9.99m },
            new Product { Id = 2, Name = "Gadget", Price = 19.95m });
    }
}
