import type { MailMessage } from '../src/mail/mailer';

export class MemoryMailer {
  readonly sent: MailMessage[] = [];
  /** Sends to these addresses fail, as an SMTP server refusing a recipient would (SP8 Review Focus 4). */
  readonly failFor = new Set<string>();

  async send(message: MailMessage): Promise<void> {
    if (this.failFor.has(message.to)) throw new Error(`550 Mailbox unavailable: ${message.to}`);
    this.sent.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to.toLowerCase());
  }

  /** Extracts the `token=` query value from the most recent mail to `to`. */
  tokenFor(to: string): string {
    const mail = this.lastTo(to);
    const match = mail?.text.match(/token=([^\s&]+)/);
    if (!match?.[1]) throw new Error(`No token mail for ${to}`);
    return decodeURIComponent(match[1]);
  }
}
