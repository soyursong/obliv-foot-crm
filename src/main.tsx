import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { canonicalRedirectTarget } from "./lib/canonicalHost";

/**
 * T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC (divergence RC fix) — 배포타깃 단일화 하드가드.
 *
 * 앱 부트 최선두(React 마운트 이전)에서 deprecated 배포 호스트(구 vercel.app)면 정본
 *   pages.dev 로 강제 이관(경로/쿼리/해시 보존). 정본·미리보기·로컬엔 무영향.
 *   (App.tsx CheckinRoute 정본 이관 선례와 동일 패턴 · 판정 SSOT = lib/canonicalHost)
 *   자가치유: 이 번들이 vercel 에 자동배포되는 즉시, 이후 vercel.app 진입은 pages.dev 로 자동 튕김.
 */
(function enforceCanonicalHost() {
  try {
    if (typeof window === "undefined") return;
    const target = canonicalRedirectTarget(
      window.location.hostname,
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    if (target) window.location.replace(target);
  } catch {
    /* 리다이렉트 실패는 앱 부팅을 막지 않는다(무해 폴백) */
  }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
