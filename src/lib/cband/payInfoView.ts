/**
 * cband/payInfoView.ts — [결제정보 확인] 모달 표시 순수 로직 (플랜A 승인응답 열람)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN
 *
 * 역할: 활성/비활성 판별 · 표시 포매팅 · PII 마스킹 · raw_response 화이트리스트 투영의
 *   **순수 함수** 계층(React·supabase 의존 0) → Playwright/Deno 결정론 커버.
 *   CbandPayInfoButton.tsx(FE)가 이 모듈을 소비한다.
 *
 * ★ 보안/PII(HARD): raw_response 를 순회하지 않고 화이트리스트 필드만 명시 read
 *   → QR_DATA_256(미마스킹 개인정보 13자리) 등은 구조적으로 표시 불가.
 */

import { formatInstallmentKo } from './protocol';

/** 비활성(기존 결제·현금·이체) 행 안내 문구 — 현장 명시(회색 only 금지). */
export const PAYINFO_INACTIVE_MESSAGE = 'CRM 결제로 진행한 건만 확인할 수 있습니다';

/**
 * [결제정보 확인] 버튼 className — 활성(플랜A)/비활성 시각 구분 SSOT.
 * ────────────────────────────────────────────────────────────────────────────
 * ★T-20260813-foot-PAYINFO-CONFIRM-ROWGATE-VISUAL(①): 옆 [단말기 취소 BETA]
 *   (CbandTerminalCancelButton)의 플랜A-행 구분 스타일과 **동형** 적용.
 *   참조 컬럼 실렌더: 활성 = `font-medium text-rose-600 hover:bg-rose-50`(채도 높은 accent),
 *   비활성 = `text-gray-400 cursor-not-allowed`(gray). → "플랜A 행만 색 다름".
 *
 *   본 컬럼은 '조회'(benign) 액션이라 참조 컬럼의 rose(위험/취소 의미)를 그대로 쓰지 않고,
 *   기존 테마(teal-emerald)의 accent 로 매핑한다(색 값 발명 0 · 기존 토큰만 참조).
 *   단, teal-700 text-only 는 테마 상시색과 겹쳐 현장에서 '모든 행 같은 색'으로 인지됨
 *   → 활성행에 상시 bg tint(chip: bg-teal-50)를 부여해 참조 컬럼의 pop 효과를 등가 달성.
 *   활성/비활성이 반드시 상이한 클래스를 산출(색 구분 불변식) — 스펙 테스트로 고정.
 */
export function payInfoButtonClass(active: boolean): string {
  const base = 'rounded px-1.5 py-0.5 text-[10px] transition';
  return active
    ? `${base} font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100`
    : `${base} text-gray-400 cursor-not-allowed`;
}

export interface CbandPayInfoPayment {
  /** CAT-origin 판별자(FK) = cband_payment_attempts.id. NOT NULL ∧ external_approval_no 존재 = 플랜A. */
  payment_attempt_id?: string | null;
  /** 승인번호(AUTHNO) — 활성 판별 보조축(VG-4). */
  external_approval_no?: string | null;
}

/**
 * 플랜A(단말기 직결) 결제 건 판별자 = payment_attempt_id IS NOT NULL ∧ external_approval_no 존재.
 *   CbandTerminalCancelButton.isPlanACardPayment 와 동일 축(VG-4 결정론). 활성 판단 단일 SSOT.
 */
export function isPayInfoAvailable(p: CbandPayInfoPayment): boolean {
  return !!p.payment_attempt_id && !!(p.external_approval_no && p.external_approval_no.trim());
}

/**
 * ★카드번호 방어적 마스킹 — 단말은 이미 마스킹 값(예 '55318440****364*')을 반환하나(extractMaskedCardNo),
 *   혹시 마스킹 마커 없는 평문 PAN(13~19 연속숫자)이 유입되면 first6/last4 만 남기고 중간을 가린다.
 *   · 마스킹 마커(별표/X) 있으면 신뢰(verbatim). · 평문 PAN-유사면 강제 마스킹. · 그 외 원값.
 */
export function maskCardNo(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/[*Xx]/.test(s)) return s;                       // 이미 마스킹됨(단말 verbatim).
  const digits = s.replace(/[ -]/g, '');
  if (/^\d{13,19}$/.test(digits)) {                    // 방어: 평문 PAN-유사 → 강제 마스킹.
    return digits.slice(0, 6) + '*'.repeat(digits.length - 10) + digits.slice(-4);
  }
  return s;
}

/** TRANDATE(YYMMDD) → 'YYYY-MM-DD'. 실패 시 원값/‘—’. */
export function fmtTranDate(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v).trim();
  if (/^\d{6}$/.test(s)) return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return s || '—';
}

/** TRANTIME(HHMMSS) → 'HH:MM:SS'. 실패 시 원값/‘—’. */
export function fmtTranTime(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v).trim();
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  return s || '—';
}

/** 거래구분(0210=승인 / 0430=취소) 표시. */
export function fmtTranType(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (s === '0210') return '승인 (0210)';
  if (s === '0430') return '취소 (0430)';
  return s || '—';
}

/** HALBU 코드('00'/'03' 등) → 한글 표기. formatInstallmentKo 재사용(0/1=일시불, N=N개월). */
export function fmtHalbu(v: string | null | undefined): string {
  if (v == null || String(v).trim() === '') return '—';
  const n = parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n)) return String(v).trim();
  return formatInstallmentKo(n);
}

/** raw_response(정규화, toPersistableRaw) 의 표시 대상 화이트리스트 subset — QR 등 미포함(구조적 차단). */
export interface RawResponseView {
  tranDate: string | null;
  tranTime: string | null;
  amount: number | null;
  halbu: string | null;
  cardNoMasked: string | null;
  cardName: string | null;
}

/**
 * ★raw_response(jsonb, 정규화 camelCase)에서 표시 화이트리스트 필드만 명시 추출.
 *   raw 를 순회하지 않으므로 QR_DATA_256/track/PAN 등 비화이트리스트 필드는 결코 반환되지 않는다(PII HARD).
 */
export function projectRawResponse(raw: Record<string, unknown> | null | undefined): RawResponseView {
  const r = raw ?? {};
  return {
    tranDate: (r.tranDate as string | null) ?? null,
    tranTime: (r.tranTime as string | null) ?? null,
    amount: typeof r.amount === 'number' ? r.amount : null,
    halbu: (r.halbu as string | null) ?? null,
    cardNoMasked: (r.cardNoMasked as string | null) ?? null,
    cardName: (r.cardName as string | null) ?? null,
  };
}
