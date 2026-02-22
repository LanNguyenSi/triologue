import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not configured');
  }
  return key;
}

export function encryptSecret(value: string, salt: string): string {
  const key = crypto.createHash('sha256').update(getEncryptionKey() + salt).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptSecret(encrypted: string, salt: string): string {
  const key = crypto.createHash('sha256').update(getEncryptionKey() + salt).digest();
  const [ivHex, encryptedHex] = encrypted.split(':');
  if (!ivHex || !encryptedHex) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}
