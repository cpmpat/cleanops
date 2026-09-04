import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Encryption for secrets that have to be stored and read back.
 *
 * Not hashing. A password is hashed because nobody ever needs it again; an API
 * key has to be handed to Avantio on every sync, so it must be recoverable.
 * That makes the threat model narrower than it looks: this protects the value
 * at rest — database backups, Neon branches, a leaked DATABASE_URL, a console
 * session — and nothing else. Anyone who can run this code can decrypt.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly rather
 * than decrypting to plausible garbage that then gets sent to a PMS.
 *
 * Stored form:  v1:<iv>:<authTag>:<ciphertext>, all base64.
 *
 * The version prefix is the thing that makes the *encryption* key itself
 * rotatable later: v2 values can appear beside v1 ones and be told apart
 * without a migration.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

/** 96 bits, the size GCM is specified around. */
const IV_BYTES = 12;

const ENV_VAR = 'CREDENTIALS_ENCRYPTION_KEY';

/**
 * The key, as 32 bytes.
 *
 * Accepts hex or base64 so whatever `openssl rand` produced can be pasted in
 * without a format argument. Read on each call rather than cached at import:
 * a module-level throw would take the whole app down at boot, and a missing
 * key must only break the operations that actually need it.
 */
function encryptionKey(): Buffer {
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new Error(
      `${ENV_VAR} is not set. It is required to read or write stored credentials. ` +
      `Generate one with: openssl rand -hex 32`,
    );
  }

  const buffer = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw.trim(), 'base64');

  if (buffer.length !== 32) {
    throw new Error(
      `${ENV_VAR} must decode to 32 bytes (got ${buffer.length}). ` +
      `Generate one with: openssl rand -hex 32`,
    );
  }
  return buffer;
}

/** True when the key is present and usable, without throwing. For health checks. */
export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/** Has this value already been through encryptSecret()? */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Read a stored secret.
 *
 * A value without the version prefix is legacy plaintext, written before this
 * existed, and is returned as-is. That is deliberate: it means the encrypting
 * build can be deployed with no migration and no downtime, and each secret
 * converts itself the next time it is saved.
 *
 * It also means a plaintext value keeps working forever, so a legacy secret is
 * not silently secure — it is secure once it has been re-saved. `isEncrypted`
 * is how a caller tells the difference and says so.
 *
 * A value that *claims* to be encrypted and will not decrypt throws. The wrong
 * key or a corrupted row must not degrade into sending an empty string to a
 * PMS as if nothing happened.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const [, ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored secret is malformed: expected v1:<iv>:<tag>:<ciphertext>.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err: any) {
    throw new Error(
      `Stored secret could not be decrypted — ${ENV_VAR} is wrong, or the value was ` +
      `written with a different key. Original error: ${err?.message ?? 'unknown'}`,
    );
  }
}

/**
 * What a secret looks like when it must appear on screen.
 *
 * Enough to answer "is this the key I think it is?" and no more. Short values
 * reveal nothing at all rather than most of themselves.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length < 8) return '••••';
  return `••••${plaintext.slice(-4)}`;
}

/** Constant-time compare, for anywhere a caller checks a secret against input. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
