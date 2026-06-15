import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * T-20260610-foot-SPA-VERSION-AUTORELOAD
 * 배포 후 현장 태블릿이 in-memory 구번들로 도는 stale-app 재발방지.
 * 빌드 시점에 고유 BUILD_ID 를 ① 번들에 주입(import.meta.env.VITE_BUILD_ID)하고,
 * ② 동일 ID 를 담은 정적 version.json 을 dist 루트에 emit 한다.
 * 클라(useVersionCheck)가 /version.json(no-cache)을 폴링/visibility 전환 시 읽어
 * 번들에 박힌 로컬 BUILD_ID 와 다르면 '새 버전' 배너를 띄운다(무패키지).
 * Vercel 은 VERCEL_GIT_COMMIT_SHA 를 제공 → 커밋 단위로 안정적인 버전 식별.
 */
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  process.env.GIT_COMMIT_SHA?.slice(0, 12) ??
  `local-${Date.now()}`;

/** dist 루트에 version.json 을 emit (빌드 시에만 동작) */
function buildVersionPlugin(): Plugin {
  return {
    name: "obliv-foot-build-version",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({
          buildId: BUILD_ID,
          builtAt: new Date().toISOString(),
        }),
      });
    },
  };
}

export default defineConfig({
  define: {
    // 번들에 빌드 ID 주입 — 클라가 서버 version.json 과 비교하는 기준값.
    // ⚠ import.meta.env.* nested define 은 dev 모드에서 Vite 가 import.meta.env 를
    //    런타임 객체로 특수 처리하기 때문에 치환이 누락된다(빌드만 동작, dev/E2E 깨짐).
    //    plain global identifier define 은 dev(esbuild)·build 양쪽에서 안정적으로 치환된다.
    __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), buildVersionPlugin()],
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
            // T-20260615-foot-GALAXYTAB-LOGIN-SLOW: 앱 전역 tiny 공유 유틸 분리.
            // clsx·tailwind-merge(cn()) 와 use-sync-external-store-shim 은 entry static graph
            // (Button/Badge 등 모든 화면)에서 쓰인다. recharts 와 같은 vendor-charts 에 묶이면
            // entry 가 clsx 한 줄 때문에 recharts 397KB 전체를 critical path 에 정적 로드 →
            // 로그인 화면조차 차트 번들을 받아 갤탭 파싱이 느려짐. 이 규칙을 recharts 규칙보다
            // 앞에 둬 tiny 유틸을 독립 청크로 빼고, vendor-charts 는 Stats 진입 시에만 lazy 로드되게 한다.
            if (/[\\/](clsx|tailwind-merge|use-sync-external-store)[\\/]/.test(id)) return 'vendor-utils';
            // recharts + 공유 의존성 (d3-* 등)을 하나로 묶어 순환 방지
            if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          }
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    // 일반 dev: 8085 (기본값)
    // Playwright E2E 전용: VITE_DEV_PORT=8089 (playwright.config.ts webServer.env 에서 주입)
    port: parseInt(process.env.VITE_DEV_PORT ?? '8085'),
  },
});
