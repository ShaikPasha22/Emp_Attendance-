import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// argon2id with OWASP-recommended parameters (19 MiB, 2 iterations).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON_OPTS);

export async function verifyPassword(passwordHash: string | null, password: string) {
  if (!passwordHash) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A real hash used to equalise timing when the user does not exist. */
let dummyHash: string | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= await hashPassword('timing-equaliser-password');
  await verifyPassword(dummyHash, password);
}
