# Deployment

Production deploy, backups, and log rotation for a Triologue instance run via
`docker-compose.yml` (see the root `Makefile`).

## Production deploy

```bash
make up         # docker compose up -d (production)
make deploy     # backup, build, restart, status
```

`docker-compose.yml` is the production-shaped compose file: it declares an
external Docker network named `traefik` (`networks.traefik.external: true`)
that the `frontend` service joins for TLS termination, and it does not
publish the frontend port directly. Create that network once per host
(`docker network create traefik`) and have a Traefik instance attached to it
before running `make up`; the compose file carries the Traefik router labels
for the default domain (`opentriologue.ai`). For local development without
Traefik, use `make dev-full` (`docker-compose.dev.yml`) instead, see the
[README quick start](../README.md#quick-start).

Requires: Docker, PostgreSQL via the `postgres` service (`docker-compose.yml`
hardcodes `DATABASE_URL` to that service and the `api` service `depends_on`
it; an external database needs a compose override of both), a `.env` with
secrets (`POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, `JWT_SECRET`).
For TLS termination alternatives (Caddy, nginx, Cloudflare Tunnel) see
[HTTPS / TLS setup](HTTPS-SETUP.md).

⚠️ Never run `docker compose down -v`, it deletes the database volume.

## Backups

`scripts/backup.sh` (also runnable via `make backup`) dumps the database into
a temp file, validates the dump's size and pg_dump's completion marker before
publishing the `.sql`, and rotates old dumps (max 10 files / 10 days). A
failed run therefore never leaves a 0-byte dump behind.

Relay-driven deploys (`.relay.yml`) do not call `make backup`. To back up on
a schedule outside of a deploy, install it as a daily root cron in
`/etc/cron.d/triologue-backup` (system crontab format, including the user
field; adjust the path to where the repository is checked out on the host):

```
17 3 * * * root /path/to/triologue/scripts/backup.sh >> /var/log/triologue-backup.log 2>&1
```

The cron entry above is silent on failure: if `pg_dump` starts erroring, or
backups stop running altogether, nothing surfaces it.
`scripts/check-backup-freshness.sh` (`make backup-freshness`) closes that
gap: it checks the newest `backups/*.sql` file's age against `MAX_AGE_HOURS`
(default 48), also fails on a 0-byte newest dump, and prints one
`backup-freshness OK: ...` or `backup-freshness FAIL: ...` line, exiting 0 or
1. It is still a passive alarm: run it on its own hourly cron entry appended
to the same log the backup cron writes, and have a human or a log watcher
read that log for `FAIL` lines (or check the exit code), since the script
does not page or notify anyone by itself.

## Schema drift report

The `post_update` step in `.relay.yml` runs `scripts/schema-drift-report.sh` after
every relay deploy. It waits (about 90 s) until no migration is pending, then
runs `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel
prisma/schema.prisma --exit-code` inside the `api` container: a read-only
comparison of the live database with `schema.prisma`. The script always exits
0, so a drift never fails the deploy or triggers the relay rollback (a rollback
cannot repair a database). It prints the result into the step output and writes
it to `backups/schema-drift.status` (one header line `<UTC time> schema-drift
OK|DRIFT|ERROR`, followed by up to 40 lines of the diff on DRIFT). The file
holds schema object names only: lines containing a URL are dropped, and when
prisma fails for any reason other than a difference (ERROR) only the exit code
and the prisma error code (P1000, P1001, ...) when present are stored, since a
connection error can name the database host. A run is recorded as DRIFT only
when prisma exited 2 and its output carries diff markers; any other exit 2 is an
ERROR.

`scripts/check-schema-drift.sh` reads that file and prints one line, in the same
style as the backup freshness check: `schema-drift OK`, `schema-drift FAIL`
(state DRIFT or ERROR, exit 1) or `schema-drift UNKNOWN` (no report yet, exit
0). Optionally install it on an hourly cron that appends to the backup log, next
to the freshness entry in `/etc/cron.d/triologue-backup`:

```
11 * * * * root /path/to/triologue/scripts/check-schema-drift.sh >> /var/log/triologue-backup.log 2>&1
```

The durable signal is the status file `backups/schema-drift.status`; the cron
line above is optional and only turns it into a `schema-drift FAIL` line in
`/var/log/triologue-backup.log`. Nothing is known to read that log: the repo does
not install the cron entry (the operator must), and no watcher of the log is
known. The natural existing reader is the triologue-health-dashboard, which
bind-mounts `backups/` read-only and already shows backup freshness from it; a
dashboard card for this file is not part of this change. Like the freshness
check the cron line is a passive alarm and does not page anyone
by itself. The record does not scroll away with the deploy log and it clears by
rule: every run rewrites the file, so the first deploy (or a manual
`sh scripts/schema-drift-report.sh`, run from the repository root on the host)
that finds no difference replaces DRIFT with OK and the `FAIL` lines stop. A
drift that is fixed by hand stays reported until such a run, because the check
only reads the last record and does not query the database itself.

## Log rotation

`scripts/logrotate.d/triologue-backup` is a logrotate snippet for the backup
and freshness-check (and schema drift check) log path used above. It uses `copytruncate` instead of
the default rename-based rotation: both scripts run under cron with a plain
`>>` redirect and neither reopens its output file, so a rename-based rotate
would silently black-hole all future log output until the next reboot or
cron restart. Copy it into `/etc/logrotate.d/` and validate with:

```bash
logrotate -d /etc/logrotate.d/triologue-backup
```
