import { AUDIT_REPORT_CONTENT_TYPE, type AuditResult } from '@taskop/contracts';
import { az, interpolate } from '@taskop/i18n';
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

/** SP8 spec §7.2: plain text with the PDF attached; one message per recipient. */
export function auditReportMail(p: {
  to: string;
  checklistName: string;
  siteName: string;
  localDate: string;
  result: AuditResult;
  auditorName: string;
  pdf: Buffer;
  filename: string;
}): MailMessage {
  const vars = { checklist: p.checklistName, site: p.siteName, date: p.localDate.split('-').reverse().join('.'), result: az.audits.results[p.result], auditor: p.auditorName };
  return {
    to: p.to,
    // A header must stay on one line: a name with a line break would otherwise end the subject early (header injection).
    subject: interpolate(az.audits.email.subject, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.replace(/\s+/g, ' ').trim()]))),
    text: interpolate(az.audits.email.body, vars),
    attachments: [{ filename: p.filename, content: p.pdf, contentType: AUDIT_REPORT_CONTENT_TYPE }],
  };
}
