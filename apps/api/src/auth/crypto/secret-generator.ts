import { randomInt } from 'node:crypto';
import { isWeakPin } from '@taskop/contracts';

export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!isWeakPin(pin)) return pin;
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(length = 14): string {
  return Array.from({ length }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
}
