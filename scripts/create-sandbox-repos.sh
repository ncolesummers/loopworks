#!/usr/bin/env bash
# Creates the Loopworks verification fixture repos in a GitHub org.
#
#   ./create-sandbox-repos.sh loopworks-sandbox
#
# Idempotent: skips a repo that already exists. Needs `gh` authenticated with
# the `repo` scope and the ability to create repos in the target org.
set -euo pipefail

ORG="${1:?usage: create-sandbox-repos.sh <org>}"

# name|visibility|default-branch|archived
REPOS=(
  "portal-web|public|main|no"
  "factory-core|private|main|no"
  "delivery-ops|private|trunk|no"
  "integration-playground|public|main|no"
  "docs-site|public|main|no"
  "spike-notes|private|main|no"
  "ops-scripts|public|develop|no"
  "legacy-runner|public|main|yes"
)

for entry in "${REPOS[@]}"; do
  IFS='|' read -r name visibility branch archived <<<"$entry"
  slug="$ORG/$name"

  if gh repo view "$slug" >/dev/null 2>&1; then
    echo "skip   $slug (exists)"
    continue
  fi

  # --add-readme forces an initial commit, so the repo has a real default branch.
  gh repo create "$slug" \
    "--$visibility" \
    --add-readme \
    --description "Loopworks verification fixture." >/dev/null
  echo "create $slug ($visibility)"

  if [[ "$branch" != "main" ]]; then
    # Rename rather than create: keeps exactly one branch, so the default is unambiguous.
    gh api -X POST "repos/$slug/branches/main/rename" -f new_name="$branch" >/dev/null
    echo "       default branch -> $branch"
  fi

  if [[ "$archived" == "yes" ]]; then
    gh repo archive "$slug" --yes >/dev/null
    echo "       archived"
  fi
done

echo
echo "Done. Repositories in $ORG:"
gh repo list "$ORG" --limit 50 --json name,visibility,isArchived,defaultBranchRef \
  --jq '.[] | "  \(.name)  \(.visibility)  \(.defaultBranchRef.name // "-")\(if .isArchived then "  [archived]" else "" end)"'
