import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import '@/lib/i18n';
import { queryClient } from '@/lib/query';
import { session } from '@/lib/session';
import { router } from '@/router';
import './styles.css';

session.subscribe(() => {
  void router.invalidate();
});

void session.bootstrap().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </StrictMode>,
  );
});
