@kind Program
@namespace System.Linq

void Main()
{
    Enumerable.Range(1, 3).Select(number => number * number).Dump("squares");
}
