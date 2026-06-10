/// <reference types="vite/client" />

// T-20260610-foot-SPA-VERSION-AUTORELOAD:
// 빌드 시 vite.config define 으로 치환되는 전역 빌드 식별자
// (Vercel commit SHA 또는 local-타임스탬프). import.meta.env.* nested define 은
// dev 모드에서 누락되므로 plain global 로 주입한다.
declare const __APP_BUILD_ID__: string;

interface Window {
  /** E2E/디버깅용 로컬 빌드 ID — page.evaluate 에서 import.meta 없이 읽기 위함 */
  __BUILD_ID__?: string;
}
