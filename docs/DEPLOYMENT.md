# Deployment and Operations

Target: any always-on Linux host with Docker. Two-worker concurrency is provided
by the Node.js server itself; no extra reverse proxy is required for the API,
but one (Nginx/Caddy) is recommended for TLS.

## 1. Docker image

Multi-stage `Dockerfile`:

- `build` stage: `node:22-alpine`, `npm ci`, `nest build`.
- runtime stage: `node:22-alpine`, non-root user `gridwise`, production
  dependencies only, `dist/` + `.env.example` copied in.
- `EXPOSE 3000`, `HEALTHCHECK` hitting `/health` with `curl`.
- No secrets anywhere in the image.

```bash
docker build -t gridwise:latest .
docker run --rm -p 3000:3000 gridwise:latest        # no env vars needed for /health
curl -s http://localhost:3000/health                # {"status":"ok"}
```

Like a judge would:

```bash
docker logout ghcr.io                                   # if publishing to GHCR
docker pull ghcr.io/<user>/gridwise:<tag>
docker run --rm -p 3000:3000 ghcr.io/<user>/gridwise:<tag>
curl -s http://localhost:3000/health
docker history --no-trunc <image> | grep -i key || echo "no secrets"   # sanity
```

## 2. Compose

`docker-compose.yml` builds locally, reads `.env` from the host, publishes
`3000:3000`, runs `restart: unless-stopped` with a `/health` healthcheck and
rotating logs.

```bash
cp .env.example .env     # fill in LLM_BASE_URL / LLM_MODEL / LLM_API_KEY
docker compose up -d --build
docker compose ps        # status must be healthy
```

## 3. Public deployment with Nginx + TLS

DNS + TLS on a VPS:

```bash
# A record: gridwise.<yourdomain> -> VPS IP
sudo certbot --nginx -d gridwise.<yourdomain>
```

Nginx site (timeouts must not cut the 30 s judge bound):

```nginx
server {
    server_name gridwise.<yourdomain>;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 35s;
        proxy_send_timeout 35s;
    }
}
```

Then `docker compose up -d` (or `systemd` running the container) targeting the
published image.

## 4. Runtime variables

| Variable | Required | Purpose |
|---|---|---|
| `LLM_BASE_URL` | yes* | OpenAI-compatible base URL of the primary provider |
| `LLM_MODEL` | yes* | Model id |
| `LLM_API_KEY` | yes* | Secret |
| `HOST` / `PORT` | no (`0.0.0.0` / `3000`) | Listen address / port |
| `CACHE_ENABLED` / `CACHE_TTL_MS` / `CACHE_MAX_ENTRIES` | no | Response cache |
| `ENABLE_HEURISTIC_FALLBACK` | no (`true`) | Fallback parser |
| `REQUEST_TIMEOUT_MS` | no (`25000`) | Whole-request budget |

\* The service starts and answers `/health` with none of them; `/optimize-energy`
then uses the labelled fallback parser.

## 5. Ops checklist for the judging window

- [ ] `restart: unless-stopped`; `docker ps` shows healthy (healthcheck passes).
- [ ] LLM key configured and tested; quota sufficient for the judging window.
- [ ] Disk and log rotation configured (compose caps logs at 10 MB × 3).
- [ ] No container pruning / rebuilds during judging that could remove the image.
- [ ] Uptime monitor on `/health` (e.g. cron curl or UptimeRobot).
- [ ] `docker logs` shows only ids, latencies, types — no keys, no prompts.
- [ ] Do not rotate keys or take the endpoint/image down until results are out.

## 6. Quick diagnostics

| Symptom | Look at |
|---|---|
| Container exits / unhealthy | `docker logs <c>`; port binding conflict |
| 504 from Nginx | `proxy_read_timeout` too low, or `REQUEST_TIMEOUT_MS` hit |
| All interpretations fallback-labelled | key/base URL/model wrong, or provider 429 → curl the provider directly |
| Slow p95 | provider latency; confirm cache; single LLM call per note |
| 400 on valid samples | DTO too strict → `npm run test:docs` locally reproduces it |