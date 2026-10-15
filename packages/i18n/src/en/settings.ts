export default {
  title: 'Settings',
  org: {
    title: 'Organisation',
    name: 'Organisation name',
    orgCode: 'Organisation code',
    orgCodeHint: 'The organisation code cannot be changed.',
    timezone: 'Time zone',
    locale: 'Language',
    localeAz: 'Azerbaijani',
  },
  password: {
    title: 'Change password',
    current: 'Current password',
    next: 'New password',
    submit: 'Change password',
    changed: 'Password changed. Sessions on other devices have been signed out.',
  },
} as const;
