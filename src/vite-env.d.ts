/// <reference types="vite/client" />

// T-20260610-foot-SPA-VERSION-AUTORELOAD: 빌드 시 vite.config define 으로 주입되는 빌드 ID
interface ImportMetaEnv {
  /** 빌드 시점에 박히는 고유 빌드 식별자 (Vercel commit SHA 또는 local-타임스탬프) */
  readonly VITE_BUILD_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
