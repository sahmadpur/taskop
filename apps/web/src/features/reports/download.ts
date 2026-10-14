import type { ReportFile } from '@taskop/api-client';

/** Long enough for the browser to start the download before the URL goes away. */
export const REVOKE_AFTER_MS = 60_000;

/** Saves a downloaded report (spec §6.2): Blob → object URL → a temporary `<a download>`. */
export function saveFile(file: ReportFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
