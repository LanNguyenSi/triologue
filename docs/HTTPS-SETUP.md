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
- Option D: **Cloudflare Tunnel** (no public ports needed, good when port 80/443 are blocked).

Pick one. Don't run two at once.

After TLS is live, set the backend's trusted origin in `.env`:

```bash
CLIENT_URL=https://your.domain
```

`CLIENT_URL` is the single origin the backend trusts: it sets both the
public client URL and the CORS allow-origin for Express and Socket.IO.

The default deploy serves the SPA and API on the **same origin** (Traefik
proxies `/api` to the backend), so the frontend needs no API base URL. Only
when the API runs on a **separate origin** do you set the `VITE_API_URL` build
arg in `docker-compose.yml` (a compile-time arg, not read from `.env`) to that
bare origin, e.g. `VITE_API_URL: "https://api.your.domain"` (no `/api` suffix).
Then rebuild the frontend.

## Option A: Traefik

The `docker-compose.yml` ships these labels on the `triologue` service:

```yaml
- "traefik.enable=true"
- "traefik.docker.network=traefik"
- "traefik.http.routers.triologue.rule=Host(`opentriologue.ai`) || Host(`www.opentriologue.ai`)"
- "traefik.http.routers.triologue.entrypoints=websecure"
- "traefik.http.routers.triologue.tls=true"
- "traefik.http.routers.triologue.tls.certresolver=letsencrypt"
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

## Publishing host ports (Options B / C / D only)

The bundled `docker-compose.yml` does NOT publish the frontend
container on a host port (line 92: `# No port mapping - Traefik
handles SSL termination`). Options B, C, and D below proxy to
`localhost:4000`, so they need that host port to exist. Add a compose
override on the host you deploy to:

```yaml
# docker-compose.override.yml
services:
  frontend:
    ports:
      - "4000:80"
```

The API is already published as `4001:3001`, so nothing extra is
needed for the backend in any option. Option A (Traefik) does not
need this override; it routes through the `traefik` Docker network.

## Option B: Caddy

Caddy ships Let's Encrypt out of the box.

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Caddyfile, replacing `your.domain` and the upstream port with the host
port the API container publishes (default `4001:3001`):

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

## Option C: nginx + Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/triologue << 'EOF'
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

  location /api/ { proxy_pass http://localhost:4001; }
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
  - hostname: your.domain
    path: /api/*
    service: http://localhost:4001
  - hostname: your.domain
    path: /socket.io/*
    service: http://localhost:4001
  - service: http_status:404
EOF

cloudflared service install
systemctl enable --now cloudflared
```

## Pre-flight checklist

After TLS is live, confirm:

- Browser shows the lock icon, no "Not Secure" warning.
- WebSockets upgrade over `wss://`, not `ws://`. Open DevTools, look for
  the Socket.io request.
- `REGISTRATION_MODE=invite` (or `closed`) is set in `.env` if you do
  not want open self-signup.
- The `lan`-equivalent admin user is flagged via SQL:

  ```bash
  psql $DATABASE_URL -c "UPDATE users SET \"isAdmin\" = true WHERE username = '<your-admin>';"
  ```

- Rate limiting is active (Redis up, default `600 req/min/IP` global
  limiter in `server/src/index.ts`).

## When to reach for which option

| You want | Pick |
|---|---|
| Match the production deployment, share a Traefik instance with other apps | A (Traefik) |
| One binary, zero TLS config, on a single VPS | B (Caddy) |
| Existing nginx setup, full control over headers | C (nginx) |
| No public ports, traffic goes through Cloudflare | D (Cloudflare Tunnel) |
