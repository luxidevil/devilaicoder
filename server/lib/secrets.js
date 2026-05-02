import crypto from 'crypto';

const ENCRYPTED_PREFIX = 'enc:v1:';
const KEY_SOURCE = process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
const KEY = KEY_SOURCE ? crypto.createHash('sha256').update(KEY_SOURCE).digest() : null;

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function canEncryptSecrets() {
  return !!KEY;
}

export function encryptSecret(value) {
  const plaintext = String(value ?? '');
  if (!plaintext) return '';
  if (!KEY) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value) {
  const raw = String(value ?? '');
  if (!raw || !isEncrypted(raw)) return raw;
  if (!KEY) return raw;

  const payload = raw.slice(ENCRYPTED_PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return raw;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return raw;
  }
}

