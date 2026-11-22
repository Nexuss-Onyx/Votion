/**
 * Password hashing.
 *
 * Primary algorithm is Argon2id (via the `argon2` package). If the native
 * binding is unavailable (e.g. a runtime without a compiled binary), the
 * module transparently falls back to Node's built-in scrypt with a random
 * salt — both produce self-describing `$`-delimited digests that
 * {@link verifyPassword} can check without knowing which algorithm ran.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;

interface Argon2Module {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

let argon2Module: Argon2Module | null | undefined;

async function loadArgon2(): Promise<Argon2Module | null> {
  if (argon2Module !== undefined) {
    return argon2Module;
  }
  try {
    const mod = (await import('argon2')) as unknown as Argon2Module;
    argon2Module = mod;
  } catch {
    argon2Module = null;
  }
  return argon2Module;
}

async function scryptHash(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function scryptVerify(digest: string, password: string): Promise<boolean> {
  const parts = digest.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = Buffer.from(parts[1] ?? '', 'base64');
  const expected = Buffer.from(parts[2] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Hashes a plaintext password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const argon2 = await loadArgon2();
  if (argon2) {
    return argon2.hash(password);
  }
  return scryptHash(password);
}

/** Verifies a plaintext password against a stored digest. */
export async function verifyPassword(
  digest: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!digest) {
    return false;
  }
  if (digest.startsWith('scrypt$')) {
    return scryptVerify(digest, password);
  }
  const argon2 = await loadArgon2();
  if (!argon2) {
    return false;
  }
  try {
    return await argon2.verify(digest, password);
  } catch {
    return false;
  }
}

/** Whether a digest uses the preferred (Argon2id) algorithm. */
export function isArgon2Digest(digest: string): boolean {
  return digest.startsWith('$argon2');
}
