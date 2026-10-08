import { setupDatabase } from '../setup';

const { DATABASE_OWNER_URL, APP_DB_PASSWORD, PLATFORM_DB_PASSWORD } = process.env;
if (!DATABASE_OWNER_URL || !APP_DB_PASSWORD || !PLATFORM_DB_PASSWORD) {
  throw new Error('DATABASE_OWNER_URL, APP_DB_PASSWORD and PLATFORM_DB_PASSWORD are required');
}

setupDatabase({ ownerUrl: DATABASE_OWNER_URL, appPassword: APP_DB_PASSWORD, platformPassword: PLATFORM_DB_PASSWORD })
  .then(() => console.log('Database ready'))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
