import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config';

export const MAILER = Symbol('MAILER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }
}
