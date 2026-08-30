#!/usr/bin/env bash
#
# Run a backend package script against PRODUCTION.
#
# Why this exists: the maintenance scripts read DATABASE_URL from the
# environment, and backend/.env points at the local docker-compose Postgres.
# Passing the production string inline every time puts a live credential into
# shell history — it has already had to be rotated once for that reason.
#
# This reads backend/.env.production instead, which is gitignored
# (backend/.gitignore line 15). The credential lives in exactly one file.
#
# Usage:
#   ./scripts/prod.sh backfill:occupancy -- --tenant prague-stays
#   ./scripts/prod.sh backfill:occupancy -- --tenant prague-stays --apply
#   ./scripts/prod.sh reconcile:turnovers -- --tenant prague-stays
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE=".env.production"

if [ ! -f "$ENV_FILE" ]; then
  cat >&2 <<MSG
backend/$ENV_FILE not found.

Create it from the template and paste your Neon connection string:

  cp .env.production.example .env.production
  \$EDITOR .env.production

It is gitignored — it will not be committed.
MSG
  exit 2
fi

# `set -a` exports everything the file defines, which is what the scripts read.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is not set in backend/$ENV_FILE}"

# The template ships with placeholders. Without this check the script happily
# tries to connect to "HOST-pooler.REGION.aws.neon.tech" and the failure comes
# back as a DNS error several seconds later, which reads like a network problem
# rather than an unedited file.
case "$DATABASE_URL" in
  *USER:PASSWORD*|*HOST-pooler.REGION*)
    cat >&2 <<MSG
backend/$ENV_FILE still contains the template placeholders.

Open it and paste the real Neon connection string:

  open -e backend/$ENV_FILE     # or: nano backend/$ENV_FILE

Neon Console -> your project -> Connection Details -> pooled connection string.
MSG
    exit 2
    ;;
esac

# Catch a mangled service-account JSON here rather than three seconds into a
# Nest boot. Unquoted in the env file, the shell eats the JSON's double quotes
# and splits on spaces, so what survives no longer starts with a brace.
if [ -n "${GCP_SERVICE_ACCOUNT_JSON:-}" ]; then
  case "$GCP_SERVICE_ACCOUNT_JSON" in
    '{'*) ;;
    *)
      cat >&2 <<MSG
GCP_SERVICE_ACCOUNT_JSON in backend/$ENV_FILE is not valid JSON.

It almost certainly needs SINGLE quotes around the whole value:

  GCP_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

Without them the shell strips the JSON's own quotes when this file is sourced.
MSG
      exit 2
      ;;
  esac
fi

# Show the target host with credentials stripped, so a run against the wrong
# database is obvious before it writes anything.
echo "→ target: ${DATABASE_URL##*@}"
echo "→ running: pnpm $*"
echo

exec pnpm "$@"
