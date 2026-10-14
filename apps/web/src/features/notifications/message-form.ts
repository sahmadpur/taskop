import { MESSAGE_LIMITS, type MessageTargetOptions, type SendMessageInput } from '@taskop/contracts';

/** A picked target; the name is only for the chips. */
export interface TargetRef {
  id: string;
  name: string;
}

export interface MessageTargets {
  users: TargetRef[];
  teams: TargetRef[];
  sites: TargetRef[];
}

export type TargetKind = keyof MessageTargets;
export const TARGET_KINDS: readonly TargetKind[] = ['users', 'teams', 'sites'];
export const NO_TARGETS: MessageTargets = { users: [], teams: [], sites: [] };

export interface MessageDraft {
  targets: MessageTargets;
  title: string;
  body: string;
  email: boolean;
}

export const EMPTY_MESSAGE: MessageDraft = { targets: NO_TARGETS, title: '', body: '', email: false };

export const targetCount = (t: MessageTargets): number => t.users.length + t.teams.length + t.sites.length;

const within = (text: string, max: number): boolean => {
  const n = text.trim().length;
  return n > 0 && n <= max;
};

/** "Göndər" is offered only for what the API accepts: a target, and a title and a body that are not blank. */
export const canPreview = (d: MessageDraft): boolean =>
  targetCount(d.targets) > 0 && within(d.title, MESSAGE_LIMITS.titleMax) && within(d.body, MESSAGE_LIMITS.bodyMax);

export const sendBody = (d: MessageDraft): SendMessageInput => ({
  title: d.title.trim(),
  body: d.body.trim(),
  userIds: d.targets.users.map((x) => x.id),
  teamIds: d.targets.teams.map((x) => x.id),
  siteIds: d.targets.sites.map((x) => x.id),
  email: d.email,
});

export type PreviewVerdict = { ok: true } | { ok: false; issue: 'notifications.issues.noRecipients' | 'notifications.issues.tooManyRecipients' };

/** The preview does not refuse (Part 1); the confirm dialog does, with the reason the send would get. */
export const previewVerdict = (recipientCount: number): PreviewVerdict =>
  recipientCount === 0
    ? { ok: false, issue: 'notifications.issues.noRecipients' }
    : recipientCount > MESSAGE_LIMITS.maxRecipients
      ? { ok: false, issue: 'notifications.issues.tooManyRecipients' }
      : { ok: true };

/** GET /notifications/messages/options returns at most this many of each kind (Part 1's messages.service). */
export const OPTION_CAPS: Readonly<Record<TargetKind, number>> = { users: 50, teams: 50, sites: 200 };

/**
 * The kinds whose list is at its cap and so may be missing names. People and teams can be narrowed with a search;
 * sites cannot (the API ignores q for them), so the picker words the two cases differently.
 */
export const cappedKinds = (o: MessageTargetOptions): TargetKind[] => TARGET_KINDS.filter((k) => o[k].length >= OPTION_CAPS[k]);
