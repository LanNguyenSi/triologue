# Archive - Historical Files

This directory contains historical files from Triologue development that are no longer actively used but kept for reference.

## Directory Structure

### `/docker-compose/`
Old Docker Compose configurations from various deployment attempts:
- `docker-compose.yml` - Original configuration
- `docker-compose-direct.yml` - Direct deployment attempt
- `docker-compose-original.yml` - Original setup
- `docker-compose-public.yml` / `docker-compose-public-fixed.yml` - Public deployment attempts
- `docker-compose.yml.backup` - Backup copy
- `dynamic.yml` - Dynamic configuration (Traefik)
- `traefik.yml` - Traefik proxy configuration

**Active file:** `../docker-compose-ice.yml` (in root)

### `/docs/`
Historical documentation from development iterations:
- `DEPLOYMENT_STATUS.md` - Old deployment status tracking
- `ICE_INTEGRATION.md` - Ice's integration notes
- `IMPLEMENTATION.md` - Implementation details
- `PORT_RESOLUTION.md` - Port conflict resolution documentation
- `TASKS.md` - Old task list
- `LAVA_BESTAETIGUNG.html` - Lava confirmation page
- `fresh-*.html` - UI test pages
- `quick-login.html` - Quick login test page

**Active docs:** `../README.md`, `../DEPLOYMENT-ICE.md` (in root)

### `/scripts/`
One-time setup and utility scripts:
- `create-users.js` - User creation script (root)
- `server-create-users.js` - Server user creation
- `hash-passwords.js` - Password hashing utility
- `seed.js` - Database seeding
- `set-passwords.js` - Password setter
- `test-connection.js` - Connection testing
- `quick-fix.sh` - Quick fix deployment
- `simple-deploy.sh` - Simple deployment script
- `setup-users.sql` - SQL user setup

**Active script:** `../deploy.sh` (in root)

## Why Archived?

These files represent various iterations during Triologue's development:
- Multiple Docker Compose files from testing different deployment strategies
- Documentation that's been superseded by current docs
- One-time setup scripts that are no longer needed

They're kept for historical reference and in case we need to reference old approaches.

---
**Archived:** 2026-02-16  
**By:** Ice 🧊
