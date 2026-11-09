import pg from "pg";

/**
 * The application's connection to Postgres, and the only sanctioned way to query as a user.
 *
 * Tenant isolation is enforced by row-level security in the database, not by WHERE clauses here.
 * That choice only holds if two things stay true, so both are made hard to get wrong:
 *
 * - The pool connects as `sealedrfq_app`, which owns no tables and has no BYPASSRLS. A connection
 *   as the migration role would disable every policy without any error, so `assertNotPrivileged`
 *   checks it at startup and the test suite checks it again.
 * - The acting user is set with `SET LOCAL` inside a transaction, so it cannot outlive the query
 *   and cannot leak onto the next borrower of a pooled connection.
 */
const DEFAULT_URL = "postgres://sealedrfq_app:localdev@localhost:5433/sealedrfq";

export const pool = new pg.Pool({
  connectionString: process.env.APP_DATABASE_URL ?? DEFAULT_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

/** A uuid, or the queries below would interpolate whatever they were handed into a SET. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run a query as a given user, inside one transaction.
 *
 * Everything the callback does sees exactly the rows that user is entitled to. There is no
 * "as nobody" shortcut: a caller with no user id gets a transaction where every policy evaluates
 * to false, which is the correct answer for an unauthenticated request rather than an error to
 * handle somewhere else.
 */
export async function withTenant<T>(
  userId: string | null,
  fn: (q: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (userId !== null && !UUID.test(userId)) throw new Error("withTenant: userId is not a uuid");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL, so it is discarded at COMMIT and cannot bleed into the next use of this
    // connection. The parameterised form keeps the value out of the statement text.
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId ?? ""]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Refuse to start if the connection could bypass row-level security.
 *
 * The failure this prevents is silent: every policy still exists, every query still works, and
 * every tenant sees every other tenant's data. It is worth one round trip at boot.
 */
export async function assertNotPrivileged(): Promise<void> {
  const { rows } = await pool.query<{ usename: string; superuser: boolean; bypassrls: boolean }>(
    `SELECT current_user AS usename,
            rolsuper AS superuser,
            rolbypassrls AS bypassrls
       FROM pg_roles WHERE rolname = current_user`,
  );
  const me = rows[0];
  if (!me) throw new Error("assertNotPrivileged: could not read the current role");
  if (me.superuser || me.bypassrls) {
    throw new Error(
      `the application is connected as "${me.usename}", which bypasses row-level security (superuser or BYPASSRLS). Every tenant policy would be inert. Connect as sealedrfq_app.`,
    );
  }
  const owns = await pool.query(
    "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user LIMIT 1",
  );
  if (owns.rowCount) {
    throw new Error(
      `the application is connected as "${me.usename}", which owns tables in public and therefore bypasses their policies. Connect as a role that owns nothing.`,
    );
  }
}
