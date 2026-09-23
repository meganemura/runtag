import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now = Date.now()): string {
  if (!Number.isFinite(now) || now < 0 || now > 0xffffffffffff) {
    throw new Error("ulid time out of range");
  }

  let time = Math.floor(now);
  let timeChars = "";
  for (let i = 0; i < 10; i += 1) {
    const index = time % 32;
    timeChars = ENCODING[index]! + timeChars;
    time = Math.floor(time / 32);
  }

  const bytes = randomBytes(10);
  let random = 0n;
  for (const byte of bytes) {
    random = (random << 8n) | BigInt(byte);
  }

  let randomChars = "";
  for (let i = 0; i < 16; i += 1) {
    const index = Number(random & 31n);
    randomChars = ENCODING[index]! + randomChars;
    random >>= 5n;
  }

  return timeChars + randomChars;
}
