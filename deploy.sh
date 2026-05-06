#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-development}"

echo "⚠️  deploy.sh ist veraltet und bleibt nur als Kompatibilitäts-Wrapper."
echo "   Bitte direkt 'make deploy' / 'make dev-full' verwenden."

case "$MODE" in
  production)
    echo "→ running: make deploy"
    exec make deploy
    ;;
  development|dev)
    echo "→ running: make dev-full"
    exec make dev-full
    ;;
  api)
    echo "→ running: make dev"
    exec make dev
    ;;
  *)
    echo "Usage: ./deploy.sh [production|development|api]"
    exit 1
    ;;
esac
