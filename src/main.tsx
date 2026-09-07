import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/tokens.css';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // On controllerchange (new SW took over after skipWaiting + clients.claim), reload once safely without loops
    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isRefreshing) return;
      const reloadedKey = 'bushido_sw_reloaded';
      if (sessionStorage.getItem(reloadedKey) === 'true') {
        sessionStorage.removeItem(reloadedKey);
        return;
      }
      isRefreshing = true;
      sessionStorage.setItem(reloadedKey, 'true');
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // If an update is waiting, tell it to skip waiting immediately
          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            }
          });
        })
        .catch((error) => {
          console.warn('[PWA] ServiceWorker registration failed:', error);
        });
    });
  } else {
    // In development mode (including AI Studio preview), unregister any active service workers
    // to prevent caching Vite HMR updates or dev modules
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        for (const key of keys) {
          if (key.startsWith('bushido-')) {
            caches.delete(key);
          }
        }
      });
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
