// Dump(): render any value inline, with an optional label.
// Dump() returns its input, so you can chain it or capture the value.

"Starting report".Dump("status");

var people = new[]
{
    new { Name = "Ada",   Age = 36, Skills = new List<string> { "Math", "Compilers" } },
    new { Name = "Grace", Age = 45, Skills = new List<string> { "COBOL", "Leadership" } },
};

people.Dump("people");

// Chained: the sum is dumped AND assigned.
var averageAge = people.Average(p => p.Age).Dump("average age");

// Final expression is still shown after the dumps.
new { Count = people.Length, AverageAge = averageAge }
