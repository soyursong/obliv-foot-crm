import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // pdf-lib (동적 import, 서류 인쇄 시에만 로드) 단독 청크 ~530 kB
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/react-dom|react-router-dom/.test(id)) return 'vendor-react';
            if (id.includes('@supabase/')) return 'vendor-supabase';
            if (id.includes('@dnd-kit/')) return 'vendor-dnd';
            if (id.includes('@tanstack/react-query')) return 'vendor-query';
            if (id.includes('date-fns')) return 'vendor-dates';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('pdf-lib')) return 'vendor-pdf';
            // recharts + 공유 의존성 (clsx, d3-* 등)을 하나로 묶어 순환 방지
            if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          }
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8082,
  },
});
