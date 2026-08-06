#!/usr/bin/env bash
# Sets the production environment variables the Loopworks config registry
# requires. The registry throws in the instrumentation hook when any is missing,
# before middleware, so an incomplete set 500s every route including `/`.
#
#   npm i -g vercel
#   vercel link --project loopworks --scope ncolesummers-projects
#   cp scripts/prod-env.example prod-env.local   # fill in the GitHub App values
#   ./scripts/set-production-env.sh prod-env.local
#
# Writes to PRODUCTION. Re-running replaces existing values.
set -euo pipefail

ENV_FILE="${1:?usage: set-production-env.sh <env-file> [project-dir]}"
# `vercel env` resolves the project from .vercel in the working directory, so it
# must run from the linked repo, not from wherever the env file lives.
PROJECT_DIR="${2:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)}"

[[ -f "$ENV_FILE" ]] || { echo "No such file: $ENV_FILE" >&2; exit 1; }
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
[[ -d "$PROJECT_DIR/.vercel" ]] || {
  echo "Not a linked Vercel project: $PROJECT_DIR (run 'vercel link' there)" >&2; exit 1;
}
cd "$PROJECT_DIR"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

REQUIRED=(
  AUTH_GITHUB_ID
  AUTH_GITHUB_SECRET
  LOOPWORKS_PUBLIC_URL

  LOOPWORKS_EVE_TEST_RECEIPT_SECRET
  GITHUB_APP_ID
  GITHUB_APP_CLIENT_ID
  GITHUB_APP_CLIENT_SECRET
  GITHUB_APP_PRIVATE_KEY
  GITHUB_APP_SLUG
  GITHUB_WEBHOOK_SECRET
)

missing=()
for key in "${REQUIRED[@]}"; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done
if (( ${#missing[@]} )); then
  printf 'Missing from %s:\n' "$ENV_FILE" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

for key in "${REQUIRED[@]}"; do
  # `vercel env rm` is a no-op failure when the key is absent, so ignore it.
  vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  if printf '%s' "${!key}" | vercel env add "$key" production --yes >/dev/null 2>&1; then
    echo "set $key"
  else
    echo "FAILED $key" >&2
    exit 1
  fi
done

echo
echo "Now redeploy so the new values are picked up:"
echo "  vercel redeploy <production-deployment-id>"
echo
# `vercel deploy --prod` uploads the current working tree, so it would ship
# whatever branch happens to be checked out. `redeploy` rebuilds a known commit.
echo "Use redeploy, not 'vercel deploy --prod' — the latter ships your working tree."
