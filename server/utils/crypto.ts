import crypto from 'node:crypto';

/**
 * Hash a plain text password using Node.js scrypt with cryptographic salt.
 * Result format: salt:key (in hex)
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a plain text password against a stored scrypt salt:key hash
 * Uses timingSafeEqual to protect against timing attacks.
 */
export async function verifyPassword(password: string, combinedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parts = combinedHash.split(':');
      if (parts.length !== 2) return resolve(false);

      const [salt, key] = parts;
      const keyBuffer = Buffer.from(key, 'hex');

      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return resolve(false);
        if (derivedKey.length !== keyBuffer.length) return resolve(false);
        resolve(crypto.timingSafeEqual(derivedKey, keyBuffer));
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Generate a cryptographically secure random session token
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a session token using SHA-256 for secure database storage
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a unique UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}
