import web from './corrections-web.js';

export default {
  title: 'Corrections',
  kinds: { manual: 'Staff correction', rework: 'Worker correction' },
  original: 'Original',
  current: 'Current',
  corrected: 'Corrected',
  cleared: 'Cleared by a correction',
  round: 'Round {{round}}',
  /** FR-19.15. */
  reworkBanner: 'Correction required',
  dueAt: 'Due: {{date}}',
  noCorrections: 'No corrections',
  emptyAnswer: 'No answer',
  actions: { correct: 'Correct answers', sendBack: 'Send back', withdraw: 'Withdraw send-back', resubmit: 'Resubmit' },
  fields: { reason: 'Reason', itemComment: 'Comment on the item', dueAt: 'Due date', items: 'Items to correct' },
  issues: {
    dueInPast: 'The due date cannot be in the past.',
    duplicateItem: 'This item is already selected.',
  },
  web,
} as const;
