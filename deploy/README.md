# The VPS

Two Node processes behind Caddy on one host. The database is Neon; nothing
runs Postgres locally.

```
        Caddy :443
       /            \
  /api/*            /*
  cma-api :3000     cma-web :3001
       \
        Neon (Postgres)  +  Cloudflare R2
```

## Deploying

Push to `main`. `.github/workflows/ci-cd.yml` typechecks, builds both halves and
applies every migration against a throwaway Postgres, then SSHes to the VPS and
runs `.github/scripts/vps-deploy.sh`, which rolls forward, rebuilds, migrates,
restarts and waits for both processes to answer.

This directory holds the pieces that live on the VPS rather than in the
pipeline: the two systemd units and the Caddyfile.

## Units

`cma-api.service` and `cma-web.service` assume the checkout at
`/home/test/cma-changamwe`, owned by `test`, matching the deploy script.

```bash
sudo cp deploy/cma-api.service deploy/cma-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cma-api cma-web
```

The deploy script restarts them through one narrow sudoers entry:

```
test ALL=(root) NOPASSWD: /usr/local/sbin/cma-deploy-restart
```

```bash
#!/bin/sh
# /usr/local/sbin/cma-deploy-restart
exec systemctl restart cma-api cma-web
```

## Caddy

`Caddyfile` puts both processes on one origin, which is what lets the refresh
cookie stay `SameSite=Strict` with no CORS. Change the domain, then:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

## Environment

`.env` lives at `/home/test/cma-changamwe/.env`, mode 600, and is not in git.
Five values differ from local:

```bash
NODE_ENV=production
SECURE_COOKIES=true      # Caddy terminates TLS
TRUST_PROXY=true         # so req.ip is the client, not Caddy
PUBLIC_BASE_URL=https://<domain>
ALLOW_DEMO_LOGIN=false
```

`DOCUMENT_SIGNING_KEY` seals every issued document. Generate one **once**, with
`npm run documents:keygen`, and keep it. Replacing it does not invalidate
documents already issued, since each records the key that signed it, but a
missing key means no document can be issued at all.

Leave `SERVERLESS=false`. The API process is long-lived, so it runs the nightly
backup and the daily reports from its own timer; there is no external cron.

`API_ORIGIN` is baked into the Next build, not read at run time. The default
`http://127.0.0.1:3000` is what both processes use on one host, so it only needs
changing if the API moves, and then the interface must be rebuilt.

## Checking on it

```bash
systemctl status cma-api cma-web
journalctl -u cma-api -f
curl -s https://<domain>/api/ready

npm run backup:verify     # re-read every backup in R2
npm run backup:run        # take one by hand
```

The administration overview shows when the last backup was verified, and warns
if none has been in 48 hours.
