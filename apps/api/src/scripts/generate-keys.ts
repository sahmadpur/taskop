import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const escape = (pem: string) => pem.trim().replace(/\n/g, '\\n');
console.log(`JWT_PRIVATE_KEY="${escape(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${escape(publicKey)}"`);
