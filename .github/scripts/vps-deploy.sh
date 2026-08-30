#!/usr/bin/env bash
# Runs on the VPS as the deploy user, piped in over SSH by the CI/CD workflow.
# Rolls the checked-out repo forward to origin/main, rebuilds both processes,
# applies pending migrations and grants, restarts, and waits for health.
set -euo pipefail

APP_DIR=/home/test/cma-changamwe
cd "$APP_DIR"

echo "==> Rolling to origin/main"
git fetch --depth 1 origin main
git reset --hard origin/main
echo "    now at $(git rev-parse --short HEAD)"

echo "==> Installing dependencies"
npm ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund

echo "==> Building API"
npm run build

echo "==> Building web (memory-capped for the 1 GB box)"
NODE_OPTIONS=--max-old-space-size=640 NEXT_TELEMETRY_DISABLED=1 nice -n 10 npm --prefix web run build

echo "==> Applying migrations and grants"
set -a; . ./.env; set +a
npm run migrate

echo "==> Restarting services"
sudo -n /usr/local/sbin/cma-deploy-restart

echo "==> Waiting for the API to answer"
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/ready >/dev/null 2>&1; then
    api_ok=1; break
  fi
  sleep 2
done
if [ "${api_ok:-}" != 1 ]; then
  echo "    API did not become ready"
  journalctl -u cma-api -n 40 --no-pager 2>/dev/null || true
  exit 1
fi

echo "==> Waiting for the web to answer"
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:3001/sign-in 2>/dev/null; then
    web_ok=1; break
  fi
  sleep 2
done
if [ "${web_ok:-}" != 1 ]; then
  echo "    web did not become ready"
  journalctl -u cma-web -n 40 --no-pager 2>/dev/null || true
  exit 1
fi

echo "==> Deployed $(git rev-parse --short HEAD) successfully"
