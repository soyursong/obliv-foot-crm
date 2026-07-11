// _shared/redpay-config.ts — RedPay 거래조회 엔드포인트 설정 SSOT (단일 정의처)
//
// T-20260710-foot-REDPAY-URL-CONFIG-HARDEN (P1, 이은상 팀장 지시 · Option A 축소재정의)
//   403 핫픽스(T-20260708 c930c423 = payments.php 전체경로 상수 박제) 후속 품질 하드닝.
//   redpay-reconcile/index.ts 에 인라인돼 있던 REDPAY_ENDPOINT 상수 + resolveRedpayEndpoint()
//   를 이 파일 한 곳으로 추출 → 형제 EF(receipt-ocr OCR-BUILD Step3)가 import 로 "공유"할 수
//   있는 진짜 SSOT 로 승격. index.ts 인라인 정의 = 형제가 import 불가였음(공유 SSOT 미충족).
//
// ── 소비처 (반드시 이 모듈을 import — 중복 하드코딩/재정의 금지) ────────────────────
//   - redpay-reconcile/index.ts            — 결제 조회 폴러 (현행 라이브 소비자)
//   - receipt-ocr (OCR-BUILD Step3 실시간 연동, T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD)
//     → 동일 URL 을 소비하므로 이 모듈을 import 해서 공유(중복 정의 금지, AC4).
//
// ── env 계약 (★ 회귀 봉쇄 최핵심) ──────────────────────────────────────────────
//   override env 키 = `REDPAY_API_URL` (이미 prod EF 에 배포된 계약). 신규 env 도입 금지.
//   폐기된 stage(30fba7e3)가 도입하려던 "payments 전용 신규 URL override 키"는 절대 도입하지
//   않는다 — env 계약 회귀 = 라이브 정산 폴러 URL 오조립 재발 경로. 이 모듈은 반드시
//   REDPAY_API_URL 하나만 읽는다(스펙 env 계약 non-regression 가드가 이를 강제).
//
// ── 403 재발방지 원칙 (ref: redpay-403-incident F0BGDKNATK7, 이은상 팀장 forensic) ──
//   [c930c423 화해] base+file 분해(urljoin/base-only concat) 금지 — `payments.php` 파일명이
//     탈락하면 요청이 디렉터리(`/api/partner/`)로 가고 nginx 가 application/json 이 아닌
//     HTML 403(디렉터리 거부)을 돌려준다. 이 HTML 403 을 "API Key 불일치"로 오진해 키를 반복
//     재등록한 사고가 있었다(F0BGDKNATK7, 2026-07-10 forensic — URL 오조립 단일원인 확정).
//     RC 재확정(T-20260711-foot-REDPAY-IPBLOCK-REVERIFY, macstudio 한국IP 실호출):
//       /api/partner/payments.php + 키 → 200 JSON / /api/partner/(파일명 탈락) → 403 HTML(IP-무관)
//       / 키 없음 → 401 JSON. ⇒ 관측 403 = payments.php 탈락 디렉터리 거부, IP/WAF 차단 아님.
//   → 전체경로를 "단일 값"으로 유지(분해 금지)하되 env override 를 허용하고, 어떤 경우에도
//     payments.php 파일명이 탈락하면 런타임 가드가 즉시 throw 하여 잘못된 URL 발사를 차단한다.

export const REDPAY_ENDPOINT = {
  /** 기본 전체경로(SSOT). env REDPAY_API_URL 로 override 가능하나 payments.php 는 불가분. */
  DEFAULT_FULL_URL: "https://redpay.kr/api/partner/payments.php",
  /** payments.php 탈락 방지 가드 — 최종 경로가 이 파일명으로 끝나야 함. */
  REQUIRED_FILENAME: "payments.php",
} as const;

/**
 * RedPay 거래조회 전체경로 resolve.
 *   - override(env REDPAY_API_URL) 없으면 DEFAULT_FULL_URL 사용.
 *   - 최종 URL 의 pathname 이 `/payments.php` 로 끝나지 않으면 throw(부모 403 사고 RC 차단).
 *   - base-only / urljoin 조립 없음 — 전체경로를 단일 값으로만 다룸.
 */
export function resolveRedpayEndpoint(): string {
  const override = (Deno.env.get("REDPAY_API_URL") ?? "").trim();
  const url = override.length > 0 ? override : REDPAY_ENDPOINT.DEFAULT_FULL_URL;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(
      `[redpay-config] REDPAY_API_URL 파싱 불가 — url=${JSON.stringify(url)}`
    );
  }
  if (!pathname.endsWith("/" + REDPAY_ENDPOINT.REQUIRED_FILENAME)) {
    throw new Error(
      `[redpay-config] REDPAY_API_URL 가드 위반 — payments.php 파일명 탈락(resolved=${url}). ` +
      `디렉터리 경로(/api/partner/)는 nginx HTML 403 을 유발(부모 403 사고 RC). ` +
      `전체경로(…/payments.php)를 사용하라.`
    );
  }
  return url;
}
