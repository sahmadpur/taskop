import type { Translations } from '../az/index.js';
import type { Shape } from '../shape.js';
import audit from './audit.js';
import audits from './audits.js';
import auth from './auth.js';
import checklists from './checklists.js';
import common from './common.js';
import corrections from './corrections.js';
import errors from './errors.js';
import executions from './executions.js';
import landing from './landing.js';
import mobile from './mobile.js';
import nav from './nav.js';
import notifications from './notifications.js';
import platform from './platform.js';
import reports from './reports.js';
import roles from './roles.js';
import scheduling from './scheduling.js';
import settings from './settings.js';
import sites from './sites.js';
import tasks from './tasks.js';
import teams from './teams.js';
import users from './users.js';

// Mirrors az/index.ts: every namespace with the same keys (checked by `satisfies` here and by i18n.test.ts at runtime).
export const ru = { common, errors, executions, landing, audit, audits, auth, checklists, corrections, mobile, nav, notifications, platform, reports, roles, scheduling, settings, sites, tasks, teams, users } satisfies Shape<Translations>;
