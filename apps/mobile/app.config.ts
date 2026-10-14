import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Android push needs Firebase's google-services.json (spec §7.1, decision 10). EAS builds get it from the file variable
 * GOOGLE_SERVICES_JSON; local builds read apps/mobile/google-services.json (gitignored). Without either the app still
 * builds, and Android push registration fails and is logged.
 */
export function googleServicesFile(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (env.GOOGLE_SERVICES_JSON) return env.GOOGLE_SERVICES_JSON;
  return exists(join(__dirname, 'google-services.json')) ? './google-services.json' : undefined;
}

export function withGoogleServices(config: ConfigContext['config'], file: string | undefined): ExpoConfig {
  const android = { ...config.android, ...(file ? { googleServicesFile: file } : {}) };
  return { ...config, android } as ExpoConfig;
}

/** app.json stays the static base (extra.eas.projectId lives there); this only adds what depends on the build machine. */
export default ({ config }: ConfigContext): ExpoConfig => withGoogleServices(config, googleServicesFile());
