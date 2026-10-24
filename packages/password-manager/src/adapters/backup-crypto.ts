import {
  randomBytes,
  scrypt as scryptCallback,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { ManagerError } from '../domain/errors.ts';
const MAGIC = Buffer.from('PWM_BACKUP_1\n');
export const MAX_BACKUP = 64 * 1024 * 1024;
async function key(password: string, salt: Buffer): Promise<Buffer> {
  if (password.length < 20) throw new ManagerError('invalid-input');
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(new ManagerError('unavailable'));
        else resolve(derived);
      }
    );
  });
}
export async function encryptBackup(
  plaintext: string,
  password: string
): Promise<Buffer> {
  if (Buffer.byteLength(plaintext) > MAX_BACKUP)
    throw new ManagerError('invalid-input');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(password, salt), iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}
export async function decryptBackup(
  ciphertext: Buffer,
  password: string
): Promise<string> {
  if (
    ciphertext.length > MAX_BACKUP + 100 ||
    !ciphertext.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new ManagerError('invalid-input');
  const offset = MAGIC.length;
  const salt = ciphertext.subarray(offset, offset + 16);
  const iv = ciphertext.subarray(offset + 16, offset + 28);
  const tag = ciphertext.subarray(offset + 28, offset + 44);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await key(password, salt),
      iv
    );
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext.subarray(offset + 44)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ManagerError('invalid-input');
  }
}
