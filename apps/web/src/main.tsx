import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { router } from '@/app/router';
import './index.css';

// Every query also refetches once a minute, the backup for when the live stream is down (spec 008).
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, refetchInterval: 60_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Just under the 61 px top bar, so a line never hides the time it is about. */}
      <Toaster position="top-center" offset={{ top: 72 }} mobileOffset={{ top: 72 }} />
    </QueryClientProvider>
  </StrictMode>,
);
