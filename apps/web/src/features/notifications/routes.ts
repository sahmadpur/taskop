/** `/messages?message=<id>`: the message whose detail is open (decision: deep-linkable, like the task drawer). */
export interface MessagesSearch {
  message?: string;
}

export const messagesSearch = (s: Record<string, unknown>): MessagesSearch =>
  typeof s.message === 'string' && s.message ? { message: s.message } : {};
