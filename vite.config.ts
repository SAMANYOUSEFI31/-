import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react/') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('motion')) {
              return 'vendor-motion';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-lucide';
            }
            return 'vendor';
          }
          if (id.includes('/src/features/admin/') || id.includes('/src/components/AdminView')) {
            return 'feature-admin';
          }
          if (id.includes('/src/features/dashboard/') || id.includes('/src/components/CycleDashboardView')) {
            return 'feature-dashboard';
          }
          if (id.includes('/src/features/archives/') || id.includes('/src/components/ArchivesView')) {
            return 'feature-archives';
          }
          if (id.includes('/src/features/profile/') || id.includes('/src/components/ProfileSettingsView')) {
            return 'feature-profile';
          }
        },
      },
    },
  },
});
