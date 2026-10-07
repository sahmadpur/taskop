export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export class MemoryMailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
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
