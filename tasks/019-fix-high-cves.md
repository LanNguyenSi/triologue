# Task 019: Fix High CVEs in Triologue

## Affected Packages (all High)

| Package | CVE Summary | Fix Version |
|---------|-------------|-------------|
| `socket.io-parser` | Unbounded binary attachments (DoS) | >= 4.2.6 |
| `express-rate-limit` | IPv4-mapped IPv6 bypass rate limiting | >= 8.2.2 |
| `multer` | DoS via uncontrolled recursion + incomplete cleanup + resource exhaustion | >= 2.1.1 |
| `minimatch` | Multiple ReDoS vulnerabilities | >= 3.1.4 / >= 9.0.7 |
| `flatted` | Prototype Pollution + unbounded recursion DoS | >= 3.4.2 |
| `rollup` | Arbitrary File Write via Path Traversal | >= 4.59.0 |

## Fix Commands

```bash
# Direct dependencies (check package.json first)
npm install socket.io@latest        # upgrades socket.io-parser transitively
npm install express-rate-limit@latest
npm install multer@latest
npm install rollup@latest           # if in devDependencies

# minimatch and flatted are likely transitive — fix via:
npm audit fix
# or force:
npm audit fix --force
```

## Notes
- `minimatch` appears many times — it's a transitive dependency of multiple packages. `npm audit fix` should handle most of these.
- `socket.io-parser` is bundled with `socket.io` — upgrading socket.io to latest should resolve it.
- `rollup` is likely a devDependency via Vite/build tools — safe to upgrade.
- Run `npm test` after upgrades.

## Priority
P1 — High severity, multiple DoS vectors + rate limit bypass + prototype pollution

## Estimated effort
~1h (mostly `npm audit fix` + test)
