import { AUDIT_REPORT_CONTENT_TYPE, type AuditResult } from '@taskop/contracts';
import { interpolate, type Language, translationsFor } from '@taskop/i18n';
import type { MailMessage } from './mailer';

const link = (webUrl: string, path: string, token: string) => `${webUrl}${path}?token=${encodeURIComponent(token)}`;

/** Every account e-mail: the recipient, their name, the web app and the one-time token, in the recipient's language. */
interface AccountMail {
  to: string;
  fullName: string;
  webUrl: string;
  token: string;
  locale: Language;
}

export function verifyEmailMail(p: AccountMail): MailMessage {
  const T = translationsFor(p.locale).mail.verifyEmail;
  return { to: p.to, subject: T.subject, text: interpolate(T.body, { name: p.fullName, link: link(p.webUrl, '/verify-email', p.token) }) };
}

export function inviteMail(p: AccountMail & { orgName: string }): MailMessage {
  const T = translationsFor(p.locale).mail.invite;
  return {
    to: p.to,
    subject: interpolate(T.subject, { org: oneLine(p.orgName) }),
    text: interpolate(T.body, { name: p.fullName, org: p.orgName, link: link(p.webUrl, '/accept-invite', p.token) }),
  };
}

export function passwordResetMail(p: AccountMail): MailMessage {
  const T = translationsFor(p.locale).mail.passwordReset;
  return { to: p.to, subject: T.subject, text: interpolate(T.body, { name: p.fullName, link: link(p.webUrl, '/reset-password', p.token) }) };
}

// A header must stay on one line: a name with a line break would otherwise end the subject early (header injection).
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** SP8 spec §7.2: plain text with the PDF attached; one message per recipient, in the auditor's language. */
export function auditReportMail(p: {
  to: string;
  checklistName: string;
  siteName: string;
  localDate: string;
  result: AuditResult;
  auditorName: string;
  pdf: Buffer;
  filename: string;
  locale: Language;
}): MailMessage {
  const T = translationsFor(p.locale).audits;
  const vars = { checklist: p.checklistName, site: p.siteName, date: p.localDate.split('-').reverse().join('.'), result: T.results[p.result], auditor: p.auditorName };
  return {
    to: p.to,
    subject: interpolate(T.email.subject, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, oneLine(v)]))),
    text: interpolate(T.email.body, vars),
    attachments: [{ filename: p.filename, content: p.pdf, contentType: AUDIT_REPORT_CONTENT_TYPE }],
  };
}
