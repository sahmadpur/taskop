export default {
  verifyEmail: {
    subject: 'Taskop — confirm your e-mail address',
    body: 'Hello, {{name}}!\n\nConfirm your e-mail address to activate your Taskop account:\n{{link}}\n\nThe link is valid for 72 hours.',
  },
  invite: {
    subject: 'Taskop — invitation to {{org}}',
    body: 'Hello, {{name}}!\n\nYou have been invited to the organisation "{{org}}" on Taskop. Open the link to set your password:\n{{link}}\n\nThe link is valid for 7 days.',
  },
  passwordReset: {
    subject: 'Taskop — password reset',
    body: 'Hello, {{name}}!\n\nOpen the link to set a new password:\n{{link}}\n\nThe link is valid for 1 hour. If you did not request this, ignore this message.',
  },
  notification: {
    open: 'Open: {{link}}',
    footer: 'You can turn these e-mails off in your profile settings.',
  },
} as const;
