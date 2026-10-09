import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { OfflineServicesProvider } from '../context';
import type { OfflineServices } from '../services';

export function renderWithServices(services: OfflineServices, ui: ReactElement) {
  return render(<OfflineServicesProvider services={services}>{ui}</OfflineServicesProvider>);
}

/** Retries an async assertion for up to 1 s: screens save through the store asynchronously after a press or blur. */
export async function eventually(check: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await check();
}
