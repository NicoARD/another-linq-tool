// Requires the "testmodel-db" profile (Select Profile in the status bar).
// The profile binds TestDbContext to a SQLite database, exposed to the script as `Db`.
// EnsureCreated() creates + seeds a fresh database on first run.

Db.Database.EnsureCreated();

var active = Db.Customers
    .Where(c => c.IsActive)
    .OrderBy(c => c.Name)
    .ToList();

active.Dump("active customers");

new { Active = active.Count, Products = Db.Products.Count() }
