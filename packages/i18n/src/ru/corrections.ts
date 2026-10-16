import web from './corrections-web.js';

export default {
  title: 'Исправления',
  kinds: { manual: 'Исправление руководителя', rework: 'Исправление сотрудника' },
  original: 'Исходный',
  current: 'Текущий',
  corrected: 'Исправлено',
  cleared: 'Снято исправлением',
  round: 'Раунд {{round}}',
  /** FR-19.15. */
  reworkBanner: 'Требуется исправление',
  dueAt: 'Срок: {{date}}',
  noCorrections: 'Исправлений нет',
  emptyAnswer: 'Нет ответа',
  actions: { correct: 'Исправить ответы', sendBack: 'Вернуть на доработку', withdraw: 'Отозвать возврат', resubmit: 'Отправить повторно' },
  fields: { reason: 'Причина', itemComment: 'Комментарий к пункту', dueAt: 'Срок', items: 'Пункты для исправления' },
  issues: {
    dueInPast: 'Срок не может быть в прошлом.',
    duplicateItem: 'Этот пункт уже выбран.',
  },
  web,
} as const;
