/**
 * Maximum length of the register form's invite-code field.
 *
 * This is the server's register-schema limit for `inviteCode`
 * (`Joi.string().alphanum().max(20)` in server/src/utils/validation.ts),
 * mirrored here because the client cannot import server code. Admins mint
 * 12-character codes and users mint 10, so a smaller limit here would
 * silently truncate a typed or pasted admin code and the registration
 * would be refused. Keep in sync with the server; the server tests pin
 * every minted code length to stay within this limit.
 */
export const INVITE_CODE_MAX_LENGTH = 20;
