import { hash, verify, Algorithm } from '@node-rs/argon2';
const OPTIONS = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
} as const;
export async function hashPassword(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
}
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
    try {
        return await verify(storedHash, plain);
    }
    catch {
        return false;
    }
}
