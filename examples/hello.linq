// C# query script. Press Ctrl+Enter to run.
// The value of the final expression (a last line WITHOUT a semicolon) is displayed.

var people = new[]
{
    new { Name = "Ada",   Age = 36, Active = true  },
    new { Name = "Alan",  Age = 41, Active = false },
    new { Name = "Grace", Age = 45, Active = true  },
};

people
    .Where(p => p.Active)
    .OrderBy(p => p.Name)
    .Select(p => new { p.Name, p.Age })
