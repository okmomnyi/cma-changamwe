import { generateKeyPairSync, createHash } from 'node:crypto';

/**
 * Mints the Ed25519 key that seals every issued document.
 *
 *   npm run documents:keygen
 *
 * Put the line it prints in .env. Keep the private half off every machine that
 * does not issue documents; replacing it invalidates nothing already signed,
 * since each document records the key id it was sealed with.
 */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const der = publicKey.export({ type: 'spki', format: 'der' });
const id = createHash('sha256').update(der).digest('hex').slice(0, 16);

console.log('# Add this to .env, and to the environment on the server.');
console.log(`DOCUMENT_SIGNING_KEY=${Buffer.from(pem).toString('base64')}`);
console.log();
console.log(`# Key id ${id}`);
console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim());
