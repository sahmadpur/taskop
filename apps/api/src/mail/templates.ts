import type { MailMessage } from './mailer';

const link = (webUrl: string, path: string, token: string) => `${webUrl}${path}?token=${encodeURIComponent(token)}`;

export function verifyEmailMail(p: { to: string; fullName: string; webUrl: string; token: string }): MailMessage {
  return {
    to: p.to,
    subject: 'Taskop — e-poçt ünvanınızı təsdiqləyin',
    text: `Salam, ${p.fullName}!\n\nTaskop hesabınızı aktivləşdirmək üçün e-poçt ünvanınızı təsdiqləyin:\n${link(p.webUrl, '/verify-email', p.token)}\n\nKeçid 72 saat etibarlıdır.`,
  };
}

export function inviteMail(p: { to: string; fullName: string; orgName: string; webUrl: string; token: string }): MailMessage {
  return {
    to: p.to,
    subject: `Taskop — ${p.orgName} təşkilatına dəvət`,
    text: `Salam, ${p.fullName}!\n\nSizi Taskop-da "${p.orgName}" təşkilatına dəvət ediblər. Şifrənizi təyin etmək üçün keçidə daxil olun:\n${link(p.webUrl, '/accept-invite', p.token)}\n\nKeçid 7 gün etibarlıdır.`,
  };
}

export function passwordResetMail(p: { to: string; fullName: string; webUrl: string; token: string }): MailMessage {
  return {
    to: p.to,
    subject: 'Taskop — şifrənin bərpası',
    text: `Salam, ${p.fullName}!\n\nŞifrənizi yeniləmək üçün keçidə daxil olun:\n${link(p.webUrl, '/reset-password', p.token)}\n\nKeçid 1 saat etibarlıdır. Bu sorğunu siz etməmisinizsə, məktubu nəzərə almayın.`,
  };
}
