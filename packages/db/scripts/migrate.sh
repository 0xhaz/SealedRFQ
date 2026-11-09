#!/usr/bin/env bash
# Apply the migrations to the local database, and create the login role the application uses.
#
# The role is created here rather than in a migration because a migration is schema, and a password
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

for m in migrations/*.sql; do
  echo "applying $(basename "$m")"
  $C < "$m"
done

# LOGIN is granted after the migration so the application's connection owns nothing and cannot
# bypass row-level security. Connecting as the table owner would disable every policy silently.
$C -c "ALTER ROLE sealedrfq_app LOGIN PASSWORD '${APP_PASSWORD}';" >/dev/null
echo "app role ready (sealedrfq_app)"
