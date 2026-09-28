import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Time-sortable, prefixed identifier (e.g. `pat_01j9x…`). */
export function newId(prefix: string): string {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) { time = ALPHABET[t % 32] + time; t = Math.floor(t / 32); }
  const rnd = randomBytes(10);
  let r = '';
  for (let i = 0; i < 10; i++) r += ALPHABET[rnd[i] % 32];
  return `${prefix}_${time}${r}`;
}
