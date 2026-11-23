import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { AuthGate } from './app/AuthGate';
import { syncLanguage } from './lib/i18n';
import { useUi } from './store/ui';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });

/**
 * Texts are translated when they are rendered, so changing the language rebuilds the page tree. The data stays in the
 * query cache and the URL is kept, so the user lands on the same screen in the other language.
 */
function Root() {
  const language = useUi((s) => s.language);
  syncLanguage(language);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter key={language}>
        <AuthGate>
          <App />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
