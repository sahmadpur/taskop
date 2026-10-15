export default {
  title: 'Düzəlişlər',
  kinds: { manual: 'Rəhbər düzəlişi', rework: 'İcraçı düzəlişi' },
  original: 'İlkin',
  current: 'Cari',
  corrected: 'Düzəliş edilib',
  cleared: 'Düzəlişlə aradan qaldırılıb',
  round: 'Raund {{round}}',
  /** FR-19.15. */
  reworkBanner: 'Düzəliş tələb olunur',
  dueAt: 'Son tarix: {{date}}',
  noCorrections: 'Düzəliş edilməyib',
  emptyAnswer: 'Cavab yoxdur',
  actions: { correct: 'Cavabları düzəlt', sendBack: 'Düzəlişə qaytar', withdraw: 'Qaytarmanı geri götür', resubmit: 'Yenidən təqdim et' },
  fields: { reason: 'Səbəb', itemComment: 'Bənd üzrə şərh', dueAt: 'Son tarix', items: 'Düzəldilməli bəndlər' },
  issues: {
    dueInPast: 'Son tarix keçmişdə ola bilməz.',
    duplicateItem: 'Bu bənd artıq seçilib.',
  },
} as const;
