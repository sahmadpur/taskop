import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config';
import { SmtpMailer } from './mailer';

describe('SmtpMailer', () => {
  it('passes attachments to nodemailer with the sender', async () => {
    const mailer = new SmtpMailer({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'Taskop <no-reply@taskop.test>' } as AppConfig);
    const transport = (mailer as unknown as { transport: { sendMail: (m: object) => Promise<unknown> } }).transport;
    const sendMail = vi.spyOn(transport, 'sendMail').mockResolvedValue({});
    const pdf = Buffer.from('%PDF-1.7');
    await mailer.send({ to: 'qa@acme.az', subject: 'S', text: 'T', attachments: [{ filename: 'a.pdf', content: pdf, contentType: 'application/pdf' }] });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Taskop <no-reply@taskop.test>', to: 'qa@acme.az', subject: 'S', text: 'T',
      attachments: [{ filename: 'a.pdf', content: pdf, contentType: 'application/pdf' }],
    });
  });
});
