#!/usr/bin/env bash
#
# Votion — Wasmer Edge deployment helper.
#
# Validates the required deployment token, locates the Wasmer CLI, and runs a
# remote (zero-Docker) build + deploy against the root `wasmer.toml` manifest.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Validate the WASMER_TOKEN environment variable.
# ---------------------------------------------------------------------------
if [[ -z "${WASMER_TOKEN:-}" ]]; then
  echo "error: WASMER_TOKEN is not set." >&2
  echo "       Export it before running: export WASMER_TOKEN=\"<YOUR_WASMER_TOKEN>\"" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Locate the Wasmer CLI: prefer ~/.wasmer/bin/wasmer, then $PATH.
# ---------------------------------------------------------------------------
WASMER_BIN=""

if [[ -x "${HOME}/.wasmer/bin/wasmer" ]]; then
  WASMER_BIN="${HOME}/.wasmer/bin/wasmer"
elif command -v wasmer >/dev/null 2>&1; then
  WASMER_BIN="$(command -v wasmer)"
else
  echo "error: Wasmer CLI not found." >&2
  echo "       Install it (https://wasmer.io) so that ~/.wasmer/bin/wasmer or 'wasmer' is on \$PATH." >&2
  exit 1
fi

echo "==> Using Wasmer CLI: ${WASMER_BIN}"
echo "==> Deploying Votion to Wasmer Edge (remote build, zero-Docker)..."

# ---------------------------------------------------------------------------
# 3. Execute the remote build and deploy from the repository root.
# ---------------------------------------------------------------------------
cd "$(dirname "$0")/../.."
exec "${WASMER_BIN}" deploy --build-remote
