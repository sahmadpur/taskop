import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_AFTER_MS, saveFile } from './download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveFile', () => {
  it('saves the blob under the server’s file name and frees the object URL afterwards', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: Array<{ href: string | null; download: string; attached: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href'), download: this.download, attached: this.isConnected });
    });
    const blob = new Blob(['x']);

    saveFile({ blob, filename: 'taskop-runs-2026-11-01_2026-11-30.xlsx' });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:report', download: 'taskop-runs-2026-11-01_2026-11-30.xlsx', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_AFTER_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});
