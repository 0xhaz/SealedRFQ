#!/usr/bin/env bash
# Apply any migrations the database has not seen, and create the login role the application uses.
#
# Applied files are recorded, so running this twice is a no-op rather than a pile of
# "relation already exists" errors. Migrations are append-only: fix a mistake with a new file, not
# by editing one that has already run somewhere.
#
# The role is created here rather than in a migration because a migration is schema and a password
# is a credential. Locally it is a known string; anywhere else it comes from the environment.
set -euo pipefail
cd "$(dirname "$0")/.."
C="docker exec -i sealedrfq-pg psql -U sealedrfq -d sealedrfq -q -v ON_ERROR_STOP=1"
APP_PASSWORD=${APP_DB_PASSWORD:-localdev}

if [ "${1:-}" = "--reset" ]; then
  echo "resetting schema"
  $C -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS app CASCADE;" >/dev/null
  $C -c "DROP ROLE IF EXISTS sealedrfq_app;" >/dev/null
fi

$C -c "CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" >/dev/null

applied=$($C -tAc "SELECT filename FROM schema_migrations")
for m in migrations/*.sql; do
  name=$(basename "$m")
  if grep -qxF "$name" <<<"$applied"; then
    echo "  skip    $name"
    continue
  fi
  echo "  apply   $name"
  $C < "$m"
  $C -c "INSERT INTO schema_migrations (filename) VALUES ('$name');" >/dev/null
done

# LOGIN is granted after the migrations so the application's connection owns nothing and cannot
# bypass row-level security. Connecting as the table owner would disable every policy silently.
$C -c "ALTER ROLE sealedrfq_app LOGIN PASSWORD '${APP_PASSWORD}';" >/dev/null
echo "app role ready (sealedrfq_app)"
