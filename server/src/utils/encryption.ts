import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-dev-key-change-in-production';
const ALGORITHM = 'aes-256-cbc';

export function encryptSecret(value: string, salt: string): string {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY + salt).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptSecret(encrypted: string, salt: string): string {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY + salt).digest();
  const [ivHex, encryptedHex] = encrypted.split(':');
  if (!ivHex || !encryptedHex) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encryptedHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}
