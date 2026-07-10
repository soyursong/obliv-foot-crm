// _shared/redpay-config.ts — RedPay API 엔드포인트 설정 SSOT (단일 정의처)
//
// T-20260710-foot-REDPAY-URL-CONFIG-HARDEN (P1, 이은상 팀장 지시)
//   403 핫픽스(T-20260708 c930c423 = payments.php 전체경로 하드코딩 박제)의 후속 품질 하드닝.
//   URL/엔드포인트를 이 파일 한 곳에 정의 → 수정 시 1곳만 → payments.php 탈락류 재발 차단.
//
// ── 소비처 (SSOT 공유) ────────────────────────────────────────────────────────
//   - redpay-reconcile/index.ts            — 결제 조회 폴러 (현행)
//   - receipt-ocr (OCR-BUILD Step3 실시간 연동, T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD)
//     → 같은 URL을 소비하므로 반드시 이 모듈을 import 해서 공유(중복 하드코딩 금지).
//
// ── 403 재발방지 원칙 (ref: redpay-403-incident F0BGDKNATK7, 이은상 팀장 forensic) ──
//   `payments.php` 파일명이 탈락하면 요청이 디렉터리 경로(/api/partner/)로 가고,
//   nginx가 application/json 이 아닌 HTML 403(디렉터리 접근 거부)을 반환한다.
//   과거 이 HTML 403을 "API Key 불일치"로 오진해 키를 반복 재등록한 사고가 있었다.
//   → 그래서:
//     (1) base+endpoint 문자열결합/urljoin 금지. "파일명 포함 전체 URL"을 단일 값으로 관리.
//     (2) env(REDPAY_PAYMENTS_URL) override 는 허용하되, 해석된 URL 에 필수 엔드포인트가
//         없으면 fail-fast(assertPaymentsUrl) — 잘못된 값이 조용히 디렉터리 경로로 새는 것 차단.
//     (3) env 미설정 시 known-good 전체 URL(DEFAULT_PAYMENTS_URL)로 폴백 → 무설정 회귀 없음.

// ── 호스트/베이스 (참고용 상수, 조립엔 직접 쓰지 않음) ─────────────────────────
export const REDPAY_HOST = "https://redpay.kr";
export const REDPAY_PARTNER_BASE = "/api/partner";

// ── 엔드포인트 파일명 — 하드코딩되기 쉬운 값 중앙화 (enum-like, as const) ──────────
export const REDPAY_ENDPOINTS = {
  payments: "payments.php",
} as const;
export type RedpayEndpoint = keyof typeof REDPAY_ENDPOINTS;

// ── known-good 전체 URL (env 미설정 시 안전 폴백 = 기존 하드코딩 박제값과 동일) ──────
export const DEFAULT_PAYMENTS_URL =
  `${REDPAY_HOST}${REDPAY_PARTNER_BASE}/${REDPAY_ENDPOINTS.payments}`;

// env 키명 (EF secrets / .env / Vercel 공용 SSOT)
export const REDPAY_PAYMENTS_URL_ENV = "REDPAY_PAYMENTS_URL";

/**
 * 결제 조회(payments) 전체 URL을 해석한다.
 *   1) env REDPAY_PAYMENTS_URL 이 설정돼 있으면 그 값
 *   2) 없으면 DEFAULT_PAYMENTS_URL (known-good)
 * 반환 전 assertPaymentsUrl 로 필수 엔드포인트 유실을 구조적으로 차단한다.
 */
export function resolveRedpayPaymentsUrl(): string {
  const fromEnv = (Deno.env.get(REDPAY_PAYMENTS_URL_ENV) ?? "").trim();
  const url = fromEnv !== "" ? fromEnv : DEFAULT_PAYMENTS_URL;
  assertPaymentsUrl(url);
  return url;
}

/**
 * 필수 엔드포인트(payments.php) 유실 가드.
 *   pathname 이 `/payments.php` 로 끝나지 않으면 throw(fail-fast).
 *   → payments.php 탈락 → nginx HTML 403 재발을 부팅 시점에 즉시 차단.
 */
export function assertPaymentsUrl(url: string): void {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(
      `[redpay-config] ${REDPAY_PAYMENTS_URL_ENV} 파싱 실패 — 유효한 URL 이 아님: ${JSON.stringify(url)}`,
    );
  }
  if (!pathname.endsWith(`/${REDPAY_ENDPOINTS.payments}`)) {
    throw new Error(
      `[redpay-config] ${REDPAY_PAYMENTS_URL_ENV} 에 필수 엔드포인트('${REDPAY_ENDPOINTS.payments}')가 없음 ` +
        `(payments.php 탈락 → nginx HTML 403 재발 위험). resolved pathname=${JSON.stringify(pathname)}. ` +
        `env ${REDPAY_PAYMENTS_URL_ENV} 는 '${DEFAULT_PAYMENTS_URL}' 처럼 파일명 포함 전체 경로로 설정할 것.`,
    );
  }
}
