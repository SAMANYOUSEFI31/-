import serverModule from '../dist/server.cjs';

// Robust ESM/CJS interop handler for Vercel Serverless Functions
const app = typeof serverModule === 'function'
  ? serverModule
  : (serverModule && typeof serverModule.default === 'function')
    ? serverModule.default
    : (serverModule && serverModule.default && typeof serverModule.default.default === 'function')
      ? serverModule.default.default
      : serverModule;

export default app;
