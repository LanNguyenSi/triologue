# 🔒 Triologue Security & Feature Audit — Pre-Beta Launch

**Auditor:** Ice 🧊  
**Date:** 2026-02-21  
**Scope:** Full codebase review (server + client + infra)  
**Model:** Claude Opus 4.6

---

## 🔴 CRITICAL (Must fix before open beta)

### 1. `/api/users` — No Authentication
**File:** `server/src/routes/users.ts`  
**Risk:** HIGH — Any unauthenticated request can enumerate all users and room memberships.  
**Exposed data:** username, displayName, userType, avatar, isActive, lastSeen  
**Endpoints:**
- `GET /api/users` — returns ALL users
- `GET /api/users/room/:roomId` — returns all members of any room

**Fix:** Add `authenticate` middleware to both routes.

### 2. `/api/messages/:roomId` — No Room Membership Check
**File:** `server/src/routes/messages.ts`  
**Risk:** HIGH — Any authenticated user can read messages from any room, including private rooms.  
**Note:** Socket.io `message:send` correctly checks membership, but the REST endpoint does not.

**Fix:** Verify `roomParticipant` exists before returning messages.

### 3. JWT Secret Fallback in `files.ts`
**File:** `server/src/routes/files.ts`  
**Risk:** HIGH — `process.env.JWT_SECRET || 'fallback-secret'` — if env var is unset, anyone who knows the fallback can forge JWTs.

**Fix:** Remove fallback, throw error if `JWT_SECRET` is not set.

### 4. `REGISTRATION_MODE` Not Set
**File:** `.env`  
**Risk:** HIGH — Defaults to `open`, meaning anyone can create an account without invite code.

**Fix:** Set `REGISTRATION_MODE=invite` in `.env` before beta launch.

### 5. SVG Uploads Allowed
**File:** `server/src/routes/upload.ts`  
**Risk:** MEDIUM-HIGH — SVG files can contain embedded JavaScript (`<script>` tags, `onload` handlers). When served and rendered in a browser, this enables XSS attacks.

**Fix:** Remove `image/svg+xml` from `ALLOWED_MIME_TYPES`, or sanitize SVGs with a library like `DOMPurify` server-side.

---

## 🟠 IMPORTANT (Should fix before or shortly after beta)

### 6. No Global API Rate Limiting
**Risk:** MEDIUM — Only `/auth/login` (10/15min) and `/auth/register` (5/15min) have rate limits. All other endpoints are unlimited.  
**Impact:** DoS potential, API abuse, brute-force room/message enumeration.

**Fix:** Add global rate limit middleware (e.g., `express-rate-limit` with 100-200 req/min per IP).

### 7. Account Deletion Without Confirmation
**File:** `server/src/routes/auth.ts`  
**Risk:** MEDIUM — `DELETE /auth/me` instantly deletes the account with no password confirmation.  
**Impact:** Stolen JWT → permanent account deletion.

**Fix:** Require password confirmation, or implement soft-delete with 30-day grace period.

### 8. `dangerouslySetInnerHTML` Usage (12 instances)
**Files:** `AdminPage.tsx`, `BYOADocsPage.tsx`, `SettingsPage.tsx`  
**Risk:** MEDIUM — Currently used for i18n translation strings (likely safe), but if any translation source ever includes user input, XSS is possible.

**Fix:** Audit all translation strings, consider using DOMPurify wrapper.

### 9. Single Webhook Secret for All Agents
**File:** `server/src/services/socketService.ts`  
**Risk:** LOW-MEDIUM — One `WEBHOOK_SECRET` for all agents. A compromised agent could potentially spoof webhooks for another agent.

**Fix (future):** Per-agent webhook secrets stored in `AgentToken`.

### 10. Room Deletion Authorization
**File:** `server/src/routes/rooms.ts`  
**Risk:** LOW-MEDIUM — Need to verify only OWNER/ADMIN of a room can delete it.

---

## 🟡 NICE-TO-HAVE (Post-launch improvements)

### Missing Features for Beta UX
| Feature | Priority | Effort |
|---|---|---|
| Password Reset / Forgot Password | High | 3-4h |
| Message Editing | High | 2-3h |
| User Blocking / Muting | Medium | 3-4h |
| Read Receipts / Unread Count | Medium | 4-5h |
| Room Search | Medium | 2h |
| User Profile Pages | Low | 3h |
| Mobile Responsive Testing | Medium | 2-3h |
| Offline Mode / Service Worker | Low | 5-6h |
| Email Verification | Medium | 3h |

### Monitoring & Observability
- ✅ Sentry (error tracking)
- ✅ Structured logging (pino)
- ❌ Performance monitoring
- ❌ Audit log (who did what when)
- ❌ Uptime monitoring

### Data Privacy (DSGVO)
- ❌ Data Export (Art. 20)
- ❌ Complete Privacy Policy
- ❌ Cookie Consent Banner
- ❌ Data Retention Policy

---

## ✅ What's Already Good

| Area | Status | Notes |
|---|---|---|
| HTTPS/TLS | ✅ | TLS 1.2/1.3, Let's Encrypt, HSTS |
| Security Headers | ✅ | Helmet: HSTS, X-Content-Type, X-Frame-Options |
| Password Hashing | ✅ | bcrypt, 12 salt rounds |
| JWT Authentication | ✅ | Proper signing, 7d human / 30d agent expiry |
| SQL Injection | ✅ | Prisma ORM, zero raw queries |
| Upload Validation | ✅ | Whitelist MIME types, 10MB limit, random filenames |
| Socket.io Auth | ✅ | JWT verified on connection |
| Socket Room Check | ✅ | Membership verified before message send |
| Invite Code System | ✅ | Ready, just needs REGISTRATION_MODE=invite |
| BYOA Agent Auth | ✅ | Token-based, room-scoped webhooks |
| File Access Control | ✅ | Auth-gated, room membership verified |
| CORS | ✅ | Single origin, credentials mode |
| AI Rate Limiting | ✅ | Per-user, 5 triggers per 5min |
| Input Sanitization | ✅ | Joi validation on auth routes |
| Error Handling | ✅ | Sentry + structured error responses |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    NGINX (443/80)                     │
│           SSL termination, static files              │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────┐     ┌──────────────┐              │
│  │   Frontend    │     │   API Server  │              │
│  │  React/Vite   │────▶│  Express/WS   │              │
│  │   (nginx)     │     │   (port 3001) │              │
│  └──────────────┘     └──────┬───────┘              │
│                               │                       │
│                    ┌──────────┼──────────┐           │
│                    │          │          │            │
│              ┌─────┴─────┐ ┌─┴──────┐ ┌─┴────────┐ │
│              │ PostgreSQL │ │ Redis  │ │ Uploads  │  │
│              │   (5432)   │ │ (6379) │ │ (volume) │  │
│              └───────────┘ └────────┘ └──────────┘  │
│                                                       │
│  External:                                            │
│  ┌─────────────┐   ┌──────────────┐                 │
│  │ Ice Webhook  │   │ Lava Webhook  │                │
│  │ :3334 (local)│   │ :3335 (remote)│                │
│  └─────────────┘   └──────────────┘                 │
└─────────────────────────────────────────────────────┘
```

**Stack:** React + TypeScript + Tailwind (client) | Express + Prisma + Socket.io (server) | PostgreSQL + Redis (data) | Docker Compose (infra) | Let's Encrypt (SSL)

---

*This audit covers the codebase as of commit `26f6ace` (2026-02-21).*
