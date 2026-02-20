# BYOA Integration Report: Triologue Agent Setup

**Date:** 2026-02-20  
**Agent:** Sisyphus (Lan's local agent)
**Target:** Triologue BYOA (Bring Your Own Agent)

---

## Summary

Successfully integrated a local AI agent with Triologue's BYOA system. The process revealed several undocumented edge cases and API behaviors that required iterative debugging.

---

## Steps Taken

### 1. Fetch BYOA Documentation
```
GET https://triologue.duckdns.org/BYOA.md
```
- Documentation is clear on high-level flow
- Missing: Timeout expectations, error handling patterns

### 2. Create Public Webhook URL
- ngrok not installed → used cloudflared as alternative
```bash
/tmp/cloudflared tunnel --url http://localhost:3336
# Result: https://archives-strikes-soul-mirrors.trycloudflare.com
```

### 3. Register Agent
- User registered agent manually at `/settings`
- Received token: `byoa_a6b81e7262a7db4ce7612128c4b865b667535430b84a886aa73ad916a5605007`

### 4. Build Webhook Server (Node.js)

**Initial version:** Hardcoded pattern matching (hello/help/math/generic)

**Problem:** User wanted real AI responses, not scripted ones.

**Solution:** Integrate Claude CLI (`claude --print --model haiku`)

### 5. Debug HTTPS Requests
- Error: `Protocol "https:" not supported. Expected "http:"`
- Fix: Import and use `https` module instead of `http` for Triologue API calls

### 6. Fix Claude CLI Spawn Issues

| Issue | Symptom | Fix |
|-------|---------|-----|
| stdin hanging | Process never completes | `stdio: ['ignore', 'pipe', 'pipe']` |
| Path resolution | spawn ENOENT | Use full path: `/home/lan/.local/bin/claude` |
| Webhook timeout | 2min+ blocking | Respond immediately, process async |
| No error visibility | Silent failures | Add debug logging to stdout/stderr |

### 7. Add Timeout Protection
```javascript
const timeout = setTimeout(() => {
  child.kill();
  reject(new Error('Timeout after 30s'));
}, 30000);
```

---

## What Was Unclear / Undocumented

### 1. Token Activation Timing
- **Expected:** Token works immediately after registration
- **Reality:** Agent starts in "pending" state, needs admin activation
- **Symptom:** `401 Invalid agent token` on early requests
- **Documentation says:** "pending until admin activates" but doesn't explain the HTTP response

### 2. Webhook Response Timing
- **Expected:** Can take time to respond, connection stays open
- **Reality:** Triologue has timeout expectations; long responses may fail silently
- **Better approach:** Respond `200 OK` immediately, then POST reply async

### 3. Claude CLI Behavior in Spawn Context
- **Expected:** `spawn('claude', [...])` works like shell
- **Reality:** CLI expects stdin even with `-p` flag; hangs waiting
- **Fix:** Explicitly ignore stdin: `stdio: ['ignore', 'pipe', 'pipe']`

### 4. Model Selection
- **Documentation shows:** No specific model examples
- **Reality:** `--model haiku` works, but trial-and-error needed to find syntax
- **Discovery:** `claude --help` shows `--model <model>` accepts aliases like 'haiku', 'sonnet', 'opus'

### 5. Context Format
- **Documentation shows:** `context` array with `{sender, content, timestamp}`
- **Unclear:** How much context is provided (10 messages), how to use it effectively
- **Decision:** Use last 5 messages to keep prompts short

---

## What Should Have Been Done Instead

### 1. API Specification Gaps
**Problem:** BYOA docs show JSON shape but not error responses.

**Better:** Document all HTTP status codes:
- `201` - Success
- `401` - Invalid/expired token OR agent not activated
- `429` - Rate limited (10 msg/min)
- `413` - Message too long (>4096 chars)

### 2. Webhook Best Practices
**Problem:** First implementation blocked on Claude response.

**Better pattern (what I ended up with):**
```javascript
req.on('end', () => {
  // Respond immediately
  res.writeHead(200).end('{"status":"ok"}');
  
  // Process async
  (async () => {
    const response = await askClaude(prompt);
    await postReply(response);
  })();
});
```

### 3. Health Check Endpoint
**Problem:** Hard to know if server is healthy.

**Better:** Add `/health` endpoint returning token validity, Claude CLI availability.

### 4. Environment Variable for Token
**Current:** Hardcoded fallback in source
```javascript
const BYOA_TOKEN = process.env.BYOA_TOKEN || 'byoa_...';
```

**Better:** Require env var, fail fast if missing:
```javascript
if (!process.env.BYOA_TOKEN) {
  console.error('BYOA_TOKEN required');
  process.exit(1);
}
```

---

## Honest Assessment

### What Went Well
- cloudflared was a good ngrok alternative (one binary, no signup)
- Triologue's webhook format is sensible and well-documented
- Claude CLI integration works once spawn quirks are handled
- Async response pattern is robust

### What Was Painful
- **5+ iterations** to get Claude CLI spawn working
- **No debug output** from spawned process initially (added logging helped)
- **Timeout vs actual failure** was hard to distinguish
- Token activation confusion wasted 2-3 test cycles

### Architecture Critique

**Current state:**
```
Triologue → Webhook → Node.js → Claude CLI (new process each message) → Reply
```

**Issues:**
- Every message spawns a fresh Claude process (~1-2s overhead)
- No conversation memory between messages (stateless)
- Single point of failure (one server process)

**Better architecture for production:**

```
Triologue → Webhook → Message Queue (Redis) 
                              ↓
                    Worker Pool (N Claude instances)
                              ↓
                         Reply Queue
                              ↓
                         Webhook posts reply
```

Or simpler: Use Anthropic API directly instead of CLI:

```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })
});
```

This avoids:
- CLI spawn overhead
- stdin/stdout pipe complexity
- Path/environment issues

---

## Recommendations for BYOA Documentation

1. **Add error code reference** with specific meanings
2. **Show async response pattern** as recommended approach
3. **Document timeout expectations** (how long can webhook take?)
4. **Add troubleshooting section** for common issues:
   - Token not working → check activation status
   - Empty responses → check response format/length
   - Timeout → use async pattern
5. **Provide reference implementations** in multiple languages (currently only TypeScript)

---

## Final Working Code

See `byoa-server.js` - key components:

1. Async response pattern
2. Claude CLI with timeout
3. Proper stdin ignore
4. Full path to binary
5. Debug logging

---

## Tunnel Persistence & Hosting Options

### Current Setup Limitations

Both tunnel and webhook server are **temporary**:

**Cloudflare Tunnel (cloudflared):**
- "account-less Tunnels have no uptime guarantee"
- Dies when: process killed, Cloudflare terminates tunnel, system reboot, network interruption
- Typical lifetime: hours to a few days
- URL changes on every restart (random like `abc123.trycloudflare.com`)

**Webhook Server (Node.js):**
- Runs until: process dies, system reboot, uncaught exception
- No automatic restart

### Hosting Options Comparison

| Option | Cost | Pros | Cons |
|--------|------|------|------|
| **ngrok Free** | 0€ | Easy setup | Random URL, dies on restart |
| **ngrok Pro** | 8€/month | Static URL, reliable | Paid |
| **ngrok Business** | 20€/month | Custom domain, teams | Expensive |
| **Cloudflare Tunnel (no account)** | 0€ | No signup | Unreliable, random URL |
| **Cloudflare Tunnel (with account)** | 0€ | Stable, custom domain | More setup |
| **VPS (Hetzner, DigitalOcean)** | 3-6€/month | Full control | Requires sysadmin |
| **Railway/Render/Fly.io** | ~5€/month | Easy deploy | Vendor lock-in |
| **Home server + DynDNS** | 0€ | Full control | Requires port forwarding, unreliable |

### ngrok Pricing Details

| Tier | Price | Static URL | Custom Domain | Tunnels |
|------|-------|------------|---------------|---------|
| Free | 0€ | No | No | 1 |
| Pro | 8€/month | Yes (`name.ngrok-free.app`) | No | 10 |
| Business | 20€/month | Yes | Yes | Unlimited |

### Recommended Setup for Production

**Option A: ngrok Pro (Easiest)**
```bash
ngrok config add-authtoken <token>
ngrok http 3336 --domain=sisyphus.ngrok-free.app
```
- Static URL persists
- Auto-reconnect on failure
- 8€/month

**Option B: Cloudflare Tunnel with Account (Free, Best Value)**
```bash
cloudflared tunnel login
cloudflared tunnel create sisyphus
cloudflared tunnel route dns sisyphus sisyphus.yourdomain.com
cloudflared tunnel run sisyphus
```
- 0€ cost
- Requires domain on Cloudflare
- Permanent URL
- More initial setup

**Option C: VPS (Most Control)**
- Hetzner CX22: 3,29€/month
- Full server control
- No tunnel needed (direct HTTPS)
- Requires Linux sysadmin skills

### Making Current Setup More Robust

If staying with free tier, add systemd service for auto-restart:

```bash
# /etc/systemd/system/byoa-agent.service
[Unit]
Description=BYOA Webhook Agent
After=network.target

[Service]
Type=simple
User=lan
WorkingDirectory=/home/lan/git/pandora
Environment=BYOA_TOKEN=byoa_...
ExecStart=/usr/bin/node byoa-server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable byoa-agent
sudo systemctl start byoa-agent
```

### Recommendation Matrix

| Use Case | Recommended Solution |
|----------|---------------------|
| Testing/Development | Current setup (cloudflared free) |
| Personal use, low budget | Cloudflare Tunnel with account |
| Personal use, want easy | ngrok Pro (8€/month) |
| Production, multiple agents | VPS (3-6€/month) |
| Team/Organization | VPS or ngrok Business |

---

## Lessons Learned

| Lesson | Application |
|--------|-------------|
| Always timeout external processes | 30s timeout on Claude CLI |
| Respond first, process later | Async webhook pattern |
| Log everything during debugging | stdout/stderr capture |
| Use full paths in spawn | `/home/lan/.local/bin/claude` |
| Check activation status early | Saved debugging time |
| Test CLI directly first | Isolated spawn issues from API issues |
| Free tunnels are temporary | Plan for persistence from start |
| Document infrastructure choices | Future self will thank you |

---

*Report generated by Sisyphus agent after successful BYOA integration.*
