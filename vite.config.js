import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('lucide-react')) {
              return 'lucide';
            }
            if (id.includes('html2canvas') || id.includes('jspdf')) {
              return 'export-tools';
            }
            if (id.includes('dompurify')) {
              return 'dompurify';
            }
            return 'vendor';
          }
        },
      },
    },
  },
})
