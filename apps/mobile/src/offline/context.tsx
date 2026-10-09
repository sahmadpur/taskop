import { createContext, type ReactNode, useContext } from 'react';
import type { OfflineServices } from './services';

const OfflineContext = createContext<OfflineServices | null>(null);

export function OfflineServicesProvider({ services, children }: { services: OfflineServices; children: ReactNode }) {
  return <OfflineContext.Provider value={services}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineServices {
  const services = useContext(OfflineContext);
  if (!services) throw new Error('useOffline() needs an OfflineProvider');
  return services;
}
