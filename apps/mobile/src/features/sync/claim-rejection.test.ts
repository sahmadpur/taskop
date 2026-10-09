import i18n from '@/lib/i18n';
import { claimRejectionText } from './claim-rejection';

describe('claimRejectionText', () => {
  const t = i18n.getFixedT(null, 'translation');
  it('names the worker who won the claim, and explains the other reasons', () => {
    expect(claimRejectionText(t, 'ALREADY_CLAIMED', 'Murad')).toBe('Bu checklist artıq Murad tərəfindən icra olunur');
    expect(claimRejectionText(t, 'ALREADY_CLAIMED', null)).toBe('Bu checklist artıq başqa əməkdaş tərəfindən icra olunur.');
    expect(claimRejectionText(t, 'NOT_ON_SHIFT', null)).toBe('Bu gün bu növbədə işləmirsiniz.');
  });
});
