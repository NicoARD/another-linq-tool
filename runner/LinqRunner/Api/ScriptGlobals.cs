namespace LinqRunner.Api;

/// <summary>
/// The script host object. Its public members are available unqualified inside scripts, so a script
/// can write <c>Db.Customers.Where(...)</c> directly. <typeparamref name="TContext"/> is the user's
/// concrete DbContext type (known only at runtime), so this is closed generically per profile.
/// </summary>
public class ScriptGlobals<TContext>
{
    public TContext Db = default!;
}
