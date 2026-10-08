import audit from './audit.js';
import auth from './auth.js';
import common from './common.js';
import errors from './errors.js';
import mobile from './mobile.js';
import nav from './nav.js';
import platform from './platform.js';
import roles from './roles.js';
import settings from './settings.js';
import sites from './sites.js';
import teams from './teams.js';
import users from './users.js';

// Each UI namespace is a file in this folder; register new ones here.
export const az = { common, errors, audit, auth, mobile, nav, platform, roles, settings, sites, teams, users } as const;
export type Translations = typeof az;
