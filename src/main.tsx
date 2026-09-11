import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/tokens.css';
import './index.css';

export const APP_SW_VERSION = 'v5';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // On controllerchange (new SW took over after skipWaiting + clients.claim), reload once safely without loops
    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isRefreshing) return;
      const reloadedKey = `bushido_sw_reloaded_${APP_SW_VERSION}`;
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

          // Handshake: Check controller version against expected APP_SW_VERSION
          const checkControllerVersion = () => {
            if (!navigator.serviceWorker.controller) return;
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              if (event.data?.type === 'SW_VERSION_RESPONSE') {
                const swVer = event.data.version;
                if (swVer && swVer !== APP_SW_VERSION) {
                  console.warn(`[PWA] Controller version mismatch: ${swVer} vs expected ${APP_SW_VERSION}. Forcing update...`);
                  navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHE' });
                  registration.update().catch(console.error);
                }
              }
            };
            navigator.serviceWorker.controller.postMessage({ type: 'CHECK_VERSION' }, [channel.port2]);
          };

          checkControllerVersion();

          // Periodic update check every 15 minutes
          setInterval(() => {
            registration.update().catch(() => {});
          }, 15 * 60 * 1000);

          // Force-check for updates on tab visibility resume and window focus (throttled to max once every 30s)
          let lastCheckTime = Date.now();
          const triggerUpdateCheck = () => {
            const now = Date.now();
            if (now - lastCheckTime > 30000) {
              lastCheckTime = now;
              registration.update().catch(() => {});
              checkControllerVersion();
            }
          };

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              triggerUpdateCheck();
            }
          });
          window.addEventListener('focus', triggerUpdateCheck);
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
