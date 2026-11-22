#!/usr/bin/env bash
#
# Votion — Wasmer Edge Zero-Docker Deployment Script
#
# Validates the deployment token and Wasmer CLI, verifies the root `wasmer.toml`
# manifest, and runs a remote edge build (`wasmer deploy --build-remote`).
#
# Usage:
#   export WASMER_TOKEN="<YOUR_WASMER_TOKEN>"
#   ./tooling/wasmer/deploy.sh [--dry-run] [--non-interactive]
#
set -euo pipefail

DRY_RUN=false
EXTRA_ARGS=()

usage() {
  cat <<'EOF'
Usage: tooling/wasmer/deploy.sh [OPTIONS]

Deploy Votion to Wasmer Edge using remote builds (zero-Docker).

Options:
  -n, --dry-run          Validate manifest, environment, and CLI config without deploying
      --non-interactive  Pass --non-interactive to wasmer deploy
  -h, --help             Show this help message and exit

Environment:
  WASMER_TOKEN           Required for live deployments (read from env / CI secret)
EOF
}

for arg in "$@"; do
  case "${arg}" in
    -n|--dry-run)
      DRY_RUN=true
      ;;
    --non-interactive)
      EXTRA_ARGS+=("--non-interactive")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option '${arg}'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MANIFEST_PATH="${REPO_ROOT}/wasmer.toml"

# ---------------------------------------------------------------------------
# 1. Validate root wasmer.toml manifest presence and required sections.
# ---------------------------------------------------------------------------
if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "error: wasmer.toml not found at ${MANIFEST_PATH}" >&2
  exit 1
fi

for required_section in "[package]" "[[services]]" "[env]"; do
  if ! grep -Fq "${required_section}" "${MANIFEST_PATH}"; then
    echo "error: wasmer.toml is missing required section ${required_section}" >&2
    exit 1
  fi
done

for required_secret in "DATABASE_URL" "REDIS_URL" "S3_ENDPOINT" "S3_ACCESS_KEY" "S3_SECRET_KEY"; do
  if ! grep -Fq "${required_secret}" "${MANIFEST_PATH}"; then
    echo "error: wasmer.toml is missing required secret binding '${required_secret}'" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 2. Validate WASMER_TOKEN environment variable (never echo secret values).
# ---------------------------------------------------------------------------
TOKEN_STATUS="configured"
if [[ -z "${WASMER_TOKEN:-}" ]]; then
  TOKEN_STATUS="missing"
elif [[ "${WASMER_TOKEN}" == "<YOUR_WASMER_TOKEN>" ]]; then
  TOKEN_STATUS="placeholder"
fi

if [[ "${DRY_RUN}" == "false" && "${TOKEN_STATUS}" != "configured" ]]; then
  if [[ "${TOKEN_STATUS}" == "placeholder" ]]; then
    echo "error: WASMER_TOKEN is still set to the '<YOUR_WASMER_TOKEN>' placeholder." >&2
  else
    echo "error: WASMER_TOKEN is not set." >&2
  fi
  echo "       Export a valid token first: export WASMER_TOKEN=\"<YOUR_WASMER_TOKEN>\"" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Locate the Wasmer CLI: prefer ~/.wasmer/bin/wasmer, then $PATH.
# ---------------------------------------------------------------------------
WASMER_BIN=""
if [[ -x "${HOME}/.wasmer/bin/wasmer" ]]; then
  WASMER_BIN="${HOME}/.wasmer/bin/wasmer"
elif command -v wasmer >/dev/null 2>&1; then
  WASMER_BIN="$(command -v wasmer)"
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  RESOLVED_CLI="${WASMER_BIN:-${HOME}/.wasmer/bin/wasmer (not installed locally)}"
  echo "==> [dry-run] Manifest validated: ${MANIFEST_PATH}"
  echo "==> [dry-run] WASMER_TOKEN status: ${TOKEN_STATUS}"
  echo "==> [dry-run] Wasmer CLI target: ${RESOLVED_CLI}"
  echo "==> [dry-run] Command: ${WASMER_BIN:-${HOME}/.wasmer/bin/wasmer} deploy --build-remote ${EXTRA_ARGS[*]:-}"
  echo "==> [dry-run] Verification succeeded (zero-Docker remote build ready)."
  exit 0
fi

if [[ -z "${WASMER_BIN}" ]]; then
  echo "error: Wasmer CLI not found." >&2
  echo "       Install it via 'curl https://get.wasmer.io -sSfL | sh' so ~/.wasmer/bin/wasmer or 'wasmer' is on \$PATH." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Execute remote build & deployment from repository root and log URL.
# ---------------------------------------------------------------------------
echo "==> Using Wasmer CLI: ${WASMER_BIN}"
echo "==> Manifest: ${MANIFEST_PATH}"
echo "==> Deploying Votion to Wasmer Edge (remote build, zero-Docker)..."

cd "${REPO_ROOT}"

DEPLOY_LOG="$(mktemp)"
trap 'rm -f "${DEPLOY_LOG}"' EXIT

set +e
"${WASMER_BIN}" deploy --build-remote "${EXTRA_ARGS[@]}" 2>&1 | tee "${DEPLOY_LOG}"
DEPLOY_EXIT_CODE="${PIPESTATUS[0]}"
set -e

if [[ "${DEPLOY_EXIT_CODE}" -ne 0 ]]; then
  echo "error: Wasmer Edge deployment failed with exit code ${DEPLOY_EXIT_CODE}." >&2
  exit "${DEPLOY_EXIT_CODE}"
fi

DEPLOY_URL="$(grep -Eo 'https://[a-zA-Z0-9._-]+\.wasmer\.app[^[:space:]]*' "${DEPLOY_LOG}" | tail -n 1 || true)"

echo "==> Deployment status: SUCCESS"
if [[ -n "${DEPLOY_URL}" ]]; then
  echo "==> Live Edge URL: ${DEPLOY_URL}"
else
  echo "==> Live Edge URL: (inspect output above or Wasmer Edge dashboard)"
fi
