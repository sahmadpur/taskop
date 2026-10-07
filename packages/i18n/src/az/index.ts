import auth from './auth.js';
import common from './common.js';
import errors from './errors.js';
import mobile from './mobile.js';
import nav from './nav.js';
import roles from './roles.js';
import settings from './settings.js';
import sites from './sites.js';
import teams from './teams.js';

// Each UI namespace is a file in this folder; register new ones here.
export const az = { common, errors, auth, nav, mobile, roles, settings, sites, teams } as const;
export type Translations = typeof az;
