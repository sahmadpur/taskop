import { ME, OTHER, pushData, TASK } from '@/offline/testing/fixtures';
import { foregroundBehavior, readPushData } from './push-data';

const SHOWN = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true };
const HIDDEN = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

describe('push data', () => {
  it('reads the data the API sends with every push and rejects anything else', () => {
    expect(readPushData(pushData())).toEqual(pushData());
    expect(readPushData(pushData({ type: 'task.assigned', targetKind: 'task', targetId: TASK, targetDate: null }))).toMatchObject({ targetKind: 'task', targetId: TASK });
    expect(readPushData({ ...pushData(), targetKind: 'site' })).toBeNull();
    expect(readPushData({ ...pushData(), userId: 'not-a-uuid' })).toBeNull();
    expect(readPushData(undefined)).toBeNull();
    expect(readPushData({ note: 'Expo push tool' })).toBeNull();
  });

  it('shows a foreground notification only to the user it was sent to', () => {
    expect(foregroundBehavior(pushData(), ME)).toEqual(SHOWN);
    expect(foregroundBehavior(pushData({ userId: OTHER }), ME)).toEqual(HIDDEN);
    expect(foregroundBehavior(pushData(), null)).toEqual(HIDDEN);
    // Not a Taskop push (an Expo test message): shown while someone is signed in, never to an anonymous app.
    expect(foregroundBehavior({ note: 'Expo push tool' }, ME)).toEqual(SHOWN);
    expect(foregroundBehavior({ note: 'Expo push tool' }, null)).toEqual(HIDDEN);
  });
});
