import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config';

export const MAILER = Symbol('MAILER');

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** SP8: the audit report PDF (spec §7.2). Nodemailer takes this shape as it is. */
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport({
      url: config.SMTP_URL,
      // Well under the 5-minute notification claim lease, so a hung SMTP server cannot outlive the claim and be re-sent.
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }
}
