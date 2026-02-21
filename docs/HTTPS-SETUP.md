# 🔒 HTTPS Setup — Triologue

> **Status:** Required before public Beta launch  
> **Time:** ~30 minutes  
> **Lava 🌋 — 2026-02-19**

---

## Option A: Caddy (Empfohlen — automatisches HTTPS)

Caddy holt automatisch Let's Encrypt Zertifikate. Zero-Config.

### 1. Caddy installieren (Ubuntu/Debian)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy
```

### 2. Caddyfile erstellen

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
triologue.duckdns.org {
    # Frontend (React app)
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
EOF
```

### 3. Caddy starten

```bash
systemctl enable caddy
systemctl start caddy
systemctl status caddy
```

> Caddy holt automatisch das SSL-Zertifikat von Let's Encrypt. Domain muss auf den Server zeigen.

---

## Option B: nginx + Certbot (klassisch)

### 1. nginx + Certbot installieren

```bash
apt install -y nginx certbot python3-certbot-nginx
```

### 2. nginx Config erstellen

```bash
cat > /etc/nginx/sites-available/triologue << 'EOF'
server {
    listen 80;
    server_name triologue.duckdns.org;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect HTTP → HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name triologue.duckdns.org;

    # SSL (certbot fills these in)
    ssl_certificate /etc/letsencrypt/live/triologue.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/triologue.duckdns.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket support
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # API + Socket.io → Backend
    location /api/ {
        proxy_pass http://localhost:4001;
    }
    location /socket.io/ {
        proxy_pass http://localhost:4001;
        proxy_read_timeout 86400s;
    }

    # Frontend → React App
    location / {
        proxy_pass http://localhost:4000;
    }
}
EOF

ln -s /etc/nginx/sites-available/triologue /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 3. SSL-Zertifikat holen

```bash
certbot --nginx -d triologue.duckdns.org --non-interactive --agree-tos -m admin@example.com
```

### 4. Auto-Renewal testen

```bash
certbot renew --dry-run
# Cronjob ist automatisch eingerichtet von certbot
```

---

## Option C: Cloudflare Tunnel (kein Port 80/443 nötig)

Wenn der VPS hinter einer Firewall ist oder Port 80/443 blockiert wird.

```bash
# Cloudflare Tunnel installieren
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Einloggen + Tunnel erstellen
cloudflared tunnel login
cloudflared tunnel create triologue
cloudflared tunnel route dns triologue triologue.duckdns.org

# Config
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: <TUNNEL-ID>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: triologue.duckdns.org
    service: http://localhost:4000
  - service: http_status:404
EOF

# Als Service starten
cloudflared service install
systemctl start cloudflared
```

---

## Nach HTTPS: .env updaten

```bash
# In .env auf dem Server:
VITE_API_URL=https://triologue.duckdns.org/api
FRONTEND_URL=https://triologue.duckdns.org
CORS_ORIGIN=https://triologue.duckdns.org
```

**Dann Frontend neu bauen:**
```bash
cd /root/git/triologue/client
npm run build
# Dist-Dateien deployen oder Docker-Container neu starten
```

---

## Checklist vor Beta

- [ ] HTTPS läuft (kein "Not Secure" im Browser)
- [ ] WebSockets funktionieren über wss:// (nicht ws://)
- [ ] Invite Codes erstellt (`REGISTRATION_MODE=invite` in .env gesetzt)
- [ ] `lan` User auf `isAdmin=true` gesetzt in DB
- [ ] Rate Limiting aktiv (Redis läuft)
- [ ] Message Pagination getestet
- [ ] Mobile UI auf echtem Smartphone getestet

### Admin-User setzen (einmalig)

```bash
# Direkt in der Datenbank (PostgreSQL):
psql $DATABASE_URL -c "UPDATE users SET \"isAdmin\" = true WHERE username = 'lan';"

# Oder via psql interaktiv:
psql $DATABASE_URL
UPDATE users SET "isAdmin" = true WHERE username = 'lan';
\q
```

---

## Prisma Migration (nach schema.prisma Änderungen)

```bash
cd /root/git/triologue/server

# Migration erstellen + anwenden
npx prisma migrate deploy

# Oder in Entwicklung:
npx prisma migrate dev --name "add-admin-invite-fields"

# Prisma Client neu generieren
npx prisma generate
```

> **Für Ice:** Mein Commit `4ea2e18` fügt `isAdmin`, `canTriggerAI` und `InviteCode` Model hinzu.  
> Bitte `npx prisma migrate deploy` auf dem Ice-Server laufen lassen nach `git pull`.

---

*Empfehlung: **Option A (Caddy)** — 5 Minuten Setup, automatische Zertifikatserneuerung, WebSocket-Support out-of-the-box.*
