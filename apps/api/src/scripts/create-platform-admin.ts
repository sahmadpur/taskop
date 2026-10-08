import { hash } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { platformAdmins } from '../db/schema';

async function main(): Promise<void> {
  const { DATABASE_PLATFORM_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_PASSWORD } = process.env;
  if (!DATABASE_PLATFORM_URL || !PLATFORM_ADMIN_EMAIL || !PLATFORM_ADMIN_NAME || !PLATFORM_ADMIN_PASSWORD) {
    throw new Error('DATABASE_PLATFORM_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME and PLATFORM_ADMIN_PASSWORD are required');
  }
  if (PLATFORM_ADMIN_PASSWORD.length < 12) throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters');
  const db = drizzle(DATABASE_PLATFORM_URL);
  const credentialHash = await hash(PLATFORM_ADMIN_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db
    .insert(platformAdmins)
    .values({ email: PLATFORM_ADMIN_EMAIL.trim().toLowerCase(), fullName: PLATFORM_ADMIN_NAME, credentialHash })
    .onConflictDoUpdate({ target: platformAdmins.email, set: { fullName: PLATFORM_ADMIN_NAME, credentialHash, active: true } });
  await db.$client.end();
  console.log(`Platform admin ${PLATFORM_ADMIN_EMAIL} is ready`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
