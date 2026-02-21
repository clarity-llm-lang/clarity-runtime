#!/usr/bin/env bash
set -euo pipefail

# Apply recommended trunk-based branch protection settings to main.
# Requires:
# - GitHub CLI authenticated with repo admin access
# - jq available
#
# Usage:
#   ./scripts/github/apply-branch-protection.sh owner repo

OWNER="${1:-}"
REPO="${2:-}"

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  echo "usage: $0 <owner> <repo>"
  exit 1
fi

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/${OWNER}/${REPO}/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "PR CI / branch-naming" },
      { "context": "PR CI / build" },
      { "context": "Dependency Review / dependency-review" },
      { "context": "Labeler / label" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "Applied branch protection for ${OWNER}/${REPO}:main"
