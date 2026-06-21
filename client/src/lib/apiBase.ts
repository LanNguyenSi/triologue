/**
 * Single source of the API origin for the whole client.
 *
 * Convention: request paths passed to `apiClient` ALWAYS include the `/api`
 * prefix (the backend mounts every route under /api). `VITE_API_URL` is
 * therefore a bare ORIGIN with NO `/api` suffix:
 *   - same-origin deploy (default): unset/empty -> '' -> requests hit `/api/...`
 *   - separate API origin:          https://api.example.com (no /api suffix)
 *
 * Setting `VITE_API_URL` to a value ending in `/api` would double-prefix every
 * request to `/api/api/...` and 404. See docker-compose*.yml build args.
 */
export const API_BASE = import.meta.env.VITE_API_URL || '';
