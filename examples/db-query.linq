// Non-functional without a db connected

var active = Db.Customers
    .Where(c => c.IsActive)
    .OrderBy(c => c.Name)
    .ToList();

active.Dump("active customers");

new { Active = active.Count, Products = Db.Products.Count() }
