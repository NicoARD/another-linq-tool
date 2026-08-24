<Query Kind="Statements">
  <Namespace>System.Linq</Namespace>
</Query>

var values = Enumerable.Range(1, 4).Select(number => number * 10);
values.Dump();