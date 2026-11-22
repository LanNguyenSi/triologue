# HTTPS / TLS setup

_Last reviewed: 2026-05-06._

How to put Triologue behind TLS in four production-ready shapes. The
backend speaks plain HTTP on `:3001` and the frontend container speaks
plain HTTP on `:80`; the reverse proxy you pick terminates TLS in front
of them.

The bundled `docker-compose.yml` already carries Traefik labels for the
default `opentriologue.ai` deployment. If you self-host on a different
domain, pick whichever reverse proxy fits your VPS:

- Option A: **Traefik** (matches the bundled labels, automatic Let's Encrypt).
- Option B: **Caddy** (single binary, automatic Let's Encrypt, simplest config).
- Option C: **nginx + Certbot** (most control, most config to write).
- Option D: **Cloudflare Tunnel** (no inbound ports needed for TLS, good when port 80/443 are blocked).

Pick one. Don't run two at once.

Each option puts a different number of proxies in front of the api, and the
api needs that number to read the client IP for its per-IP rate limits
(`TRUST_PROXY_HOPS`, see [Environment](environment.md)). `docker-compose.yml`
sets `2`, which fits Options A and D; Options B and C need
`TRUST_PROXY_HOPS=1` in `.env`, which is the exact count there. With too low
a value all clients share one rate-limit bucket. A value above the real count
only lets a client choose its own address when the proxy appends to
`X-Forwarded-For` (a host nginx, or Caddy with `trusted_proxies`); a proxy
that replaces the header hides the client's value.

After TLS is live, set the backend's trusted origin in `.env`:

```bash
CLIENT_URL=https://your.domain
```

`CLIENT_URL` is the single origin the backend trusts: it sets the CORS
allow-origin for Express and Socket.IO. The server does not use it for
redirects.

The default deploy serves the SPA and API on the **same origin** (Traefik
routes to the frontend container, whose nginx proxies `/api` to the backend),
so the frontend needs no API base URL. Only when the API runs on a **separate
origin** do you set the `VITE_API_URL` build arg in `docker-compose.yml` (a
compile-time arg, not read from `.env`) to that bare origin, e.g.
`VITE_API_URL: "https://api.your.domain"` (no `/api` suffix). Then rebuild the
frontend.

## Option A: Traefik

The `docker-compose.yml` ships these labels on the `frontend` service (router name `triologue`):

```yaml
- "traefik.enable=true"
- "traefik.docker.network=traefik"
- "traefik.http.routers.triologue.rule=Host(`opentriologue.ai`) || Host(`www.opentriologue.ai`)"
- "traefik.http.routers.triologue.entrypoints=websecure"
- "traefik.http.routers.triologue.tls=true"
- "traefik.http.routers.triologue.tls.certresolver=letsencrypt"
- "traefik.http.services.triologue.loadbalancer.server.port=80"
```

If you already run a Traefik instance on the same Docker host with a
`letsencrypt` resolver and a `traefik` external network, just change
the `Host(...)` rule to your own domain in `docker-compose.yml`.

If you don't yet have Traefik on the host, install it first (one-time):

```bash
docker network create traefik

cat > /opt/traefik/traefik.yml << 'EOF'
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    exposedByDefault: false
    network: traefik

certificatesResolvers:
  letsencrypt:
    acme:
      email: you@example.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
EOF
```

Then run Traefik itself in compose alongside Triologue, exposing :80
and :443 on the host. Triologue's labels do the rest.

Proxy hops: 2 (Traefik, then the frontend nginx, which proxies `/api` and
`/socket.io` to the api). This is the `docker-compose.yml` default, so
`TRUST_PROXY_HOPS` needs no entry in `.env`.

## Publishing host ports (Options B / C / D only)

The bundled `docker-compose.yml` does NOT publish the frontend
container on a host port; the `frontend` service has no `ports:`
mapping, see the `# No port mapping - Traefik handles SSL termination`
comment. Options B, C, and D below proxy to
`localhost:4000`, so they need that host port to exist. Add a compose
override on the host you deploy to:

```yaml
# docker-compose.override.yml
services:
  frontend:
    ports:
      - "127.0.0.1:4000:80"
```

The API is already published as `127.0.0.1:4001:3001` (loopback only), so
nothing extra is needed for the backend in any option. Option A (Traefik) does not
need this override; it routes through the `traefik` Docker network.

A port mapping without a host IP binds on all interfaces, so it is reachable
without TLS from outside the host. The shipped `docker-compose.yml` therefore
binds the API to the loopback interface (`"127.0.0.1:4001:3001"`). Bind the
frontend override the same way (`"127.0.0.1:4000:80"`), since Options B, C and
D reach both over `localhost`, and block 4000 and 4001 at the host firewall as
defence in depth (see Firewall in `docs/deployment.md`). To call the API
directly from another host, use an explicit compose override as described
there.

## Option B: Caddy

Caddy ships Let's Encrypt out of the box.

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Caddyfile, replacing `your.domain` and the upstream port with the host
port the API container publishes (default `127.0.0.1:4001:3001`):

```caddy
your.domain {
  handle /api/* {
    reverse_proxy localhost:4001
  }
  handle /socket.io/* {
    reverse_proxy localhost:4001 {
      header_up Upgrade {http.request.header.Upgrade}
      header_up Connection {http.request.header.Connection}
    }
  }
  handle {
    reverse_proxy localhost:4000
  }
}
```

Start it:

```bash
systemctl enable --now caddy
systemctl status caddy
```

The first request triggers Let's Encrypt issuance and Caddy renews
automatically.

Proxy hops: 1. Caddy sends `/api/*` straight to `localhost:4001`, so set
`TRUST_PROXY_HOPS=1` in `.env`: 1 is the exact count. With Caddy's default
(no `trusted_proxies`) Caddy replaces `X-Forwarded-For`, so the compose
default of 2 still gives the real client. Once `trusted_proxies` covers the
real client, Caddy appends to `X-Forwarded-For`, so 2 would let a client
choose its own rate-limit address. If `trusted_proxies` instead covers an
upstream proxy (for example Cloudflare ranges), that proxy is a real hop and
must be counted. `/socket.io/*` also goes straight to the api; Socket.IO
reads no client IP, so it is not affected. The catch-all
`handle` sends everything else to the frontend on `localhost:4000`, which
only serves the SPA there: the frontend nginx forwards `/api/` and
`/socket.io/` to the api, and Caddy's two matchers above take those paths
first, so no api request passes two proxies.

## Option C: nginx + Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/triologue << 'EOF'
# http level: Debian's nginx includes sites-enabled files inside the
# http {} block of nginx.conf, so this log_format is valid at the top
# of this file, before the first server block. If your nginx.conf
# includes this file anywhere else, move the log_format directive
# inside the http {} block of nginx.conf itself. It mirrors
# nginx/traefik.conf: client/src/lib/fileUrl.ts appends a short-lived
# file token (?ft=...) to /api/files/ URLs; it is bound to one file and
# one user and expires after minutes, never the session JWT. The default
# format logs "$request" with the query string, so the files location
# logs with this query-free format instead (defence in depth).
log_format files_without_query '$remote_addr - $remote_user [$time_local] '
                               '"$request_method $uri $server_protocol" $status $body_bytes_sent '
                               '"$http_referer" "$http_user_agent" "$http_x_forwarded_for"';

server {
  listen 80;
  server_name your.domain;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name your.domain;

  ssl_certificate /etc/letsencrypt/live/your.domain/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your.domain/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  # ^~ so a regex location cannot take an /api/ path; the body limit
  # matches MAX_FILE_SIZE (10 MB) in server/src/routes/upload.ts plus
  # headroom for the multipart framing.
  location ^~ /api/ {
    client_max_body_size 12m;
    proxy_pass http://localhost:4001;
  }
  # File downloads, logged without the query so the ?ft=<file token>
  # never reaches the access log (format at the top of this file); a request
  # nginx redirects here gets a relative Location, so the redirect
  # cannot spell the token into an absolute http:// URL.
  location ^~ /api/files/ {
    access_log /var/log/nginx/access.log files_without_query;
    absolute_redirect off;
    proxy_pass http://localhost:4001;
  }
  location /socket.io/ {
    proxy_pass http://localhost:4001;
    proxy_read_timeout 86400s;
  }
  location / { proxy_pass http://localhost:4000; }
}
EOF

ln -s /etc/nginx/sites-available/triologue /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

certbot --nginx -d your.domain --non-interactive --agree-tos -m you@example.com
certbot renew --dry-run
```

The `log_format` directive must sit at http level, which here means at
the top of this file before the first `server` block, because Debian's
nginx includes files from `sites-enabled/` inside the `http {}` block of
`nginx.conf` (the `nginx -t` run above rejects it if that is wrong for
your layout).

Proxy hops: 1. This server block sends `/api/` and `/socket.io/` straight to
`localhost:4001`, so set `TRUST_PROXY_HOPS=1` in `.env`; it appends to
`X-Forwarded-For` (`$proxy_add_x_forwarded_for`), so with the compose default
of 2 a client could choose its own rate-limit address.

## Option D: Cloudflare Tunnel

Useful when port 80/443 is unavailable on the host (firewall, NAT, no
public IP).

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

cloudflared tunnel login
cloudflared tunnel create triologue
cloudflared tunnel route dns triologue your.domain

cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: <TUNNEL-ID>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: your.domain
    service: http://localhost:4000
  - service: http_status:404
EOF

cloudflared service install
systemctl enable --now cloudflared
```

The frontend container already proxies `/api` and `/socket.io` to the API
(`nginx/traefik.conf`), so one rule to `localhost:4000` is enough.

Proxy hops: 2 (`cloudflared`, then the frontend nginx). This is the
`docker-compose.yml` default, so `TRUST_PROXY_HOPS` needs no entry in `.env`.

## Pre-flight checklist

After TLS is live, confirm:

- Browser shows the lock icon, no "Not Secure" warning.
- WebSockets upgrade over `wss://`, not `ws://`. Open DevTools, look for
  the Socket.io request.
- `REGISTRATION_MODE=invite` (or `closed`) is set in `.env` if you do
  not want open self-signup.
- `ADMIN_USERNAME` (required, no default) and `ADMIN_PASSWORD` were set in
  `.env` before the first start. The seed creates that admin user and sets its admin flag on
  every `api` start; it never changes an existing user's password (see
  [Deployment, First start](deployment.md#first-start)).
- Rate limiting is active (in memory per API process;
  `GLOBAL_RATE_LIMIT_MAX` requests per minute per IP on `/api`, default 600
  with `NODE_ENV=production`).
- `TRUST_PROXY_HOPS` matches the option: unset (compose default 2) for A
  and D, `1` in `.env` for B and C.

## When to reach for which option

| You want | Pick |
|---|---|
| Match the production deployment, share a Traefik instance with other apps | A (Traefik) |
| One binary, zero TLS config, on a single VPS | B (Caddy) |
| Existing nginx setup, full control over headers | C (nginx) |
| No inbound ports for TLS, traffic goes through Cloudflare | D (Cloudflare Tunnel) |
