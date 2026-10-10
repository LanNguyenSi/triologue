/**
 * Usernames of the server's service accounts (the gateway).
 *
 * This is the single definition every site that special-cases these accounts
 * imports:
 * - routes/agents.ts accepts a bearer token as the gateway's only when its
 *   user has one of these usernames;
 * - routes/rooms.ts and routes/users.ts hide users with these usernames from
 *   participant, invitable and mention lists;
 * - routes/auth.ts refuses them at POST /register and GET /check-username,
 *   and leaves them unchanged when DELETE /me renames agent accounts.
 *
 * Entries are lowercase because registration lowercases usernames
 * (sanitize.username) before comparing.
 */
export const SERVICE_ACCOUNT_USERNAMES: readonly string[] = Object.freeze([
  'gateway',
  'gateway-agent-001',
]);

/** True when `username` (case- and whitespace-insensitive) is reserved. */
export function isServiceAccountUsername(username: string | null | undefined): boolean {
  if (typeof username !== 'string') return false;
  return SERVICE_ACCOUNT_USERNAMES.includes(username.toLowerCase().trim());
}
