import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { preloadStoredThemePackFonts } from './themeFontLoader.js';
import './i18n.js';
import './index.css';

function mountRoot() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void preloadStoredThemePackFonts()
  .catch(() => {
    /* Font chunk failure should not block the app */
  })
  .finally(mountRoot);
