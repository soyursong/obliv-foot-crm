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

import { formatInstallmentKo, TRANTYPE_APPROVE, TRANTYPE_CANCEL } from './protocol';

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

/* ════════════════════════════════════════════════════════════════════════════
 * 승인+취소 동시표시 (기획서 3-2) — T-20260813-foot-PAYINFO-MODAL-CANCELPAIR-DISPLAY
 * ────────────────────────────────────────────────────────────────────────────
 * 배경(현장): 플랜A 결제가 취소된 경우 결제내역/모달이 승인 응답만 보여줘 '취소됨'이
 *   드러나지 않음 → 실장이 취소건을 승인건으로 오인. 모달에서 승인(0210)과 취소(0430)를
 *   ★동일 원거래 기준 함께 노출해 정산 정합을 눈으로 확인.
 * 매칭 키 = AUTHNO(auth_no · 원거래 동일) · 승인/취소 구분 = TRANTYPE(0210/0430)+TRANSERIAL(msg_trace).
 * ★조회 전용(write-path 무접촉) · PII 화이트리스트 투영·마스킹은 부모 로직(projectRawResponse/maskCardNo) 계승.
 * ════════════════════════════════════════════════════════════════════════════ */

/** 모달 표시용 단일 거래(승인 or 취소) 정규화 행. raw 는 화이트리스트 subset(projectRawResponse). */
export interface PayInfoAttempt {
  tran_type: string | null;
  auth_no: string | null;
  /** TRANSERIAL(거래고유번호, msg_trace 12자리) — 유실 시 단말기 승인내역조회 유일 키 + 승인/취소 행 구분자. */
  msg_trace: string | null;
  merno: string | null;
  cat_tid: string | null;
  response_code: string | null;
  requested_amount: number | null;
  raw: RawResponseView;
}

/** 동일 AUTHNO 원거래를 승인 leg + 취소 leg 로 분리한 결과. */
export interface PayInfoLegs {
  /** 승인(0210) — 원거래. 정상적으로 1건. */
  approval: PayInfoAttempt | null;
  /** 취소(0430) — 부분/전체 취소. 통상 0~1건이나 다건 방어(TRANSERIAL 별 분리). */
  cancels: PayInfoAttempt[];
  /** 동일 AUTHNO 에 취소가 존재 = 승인이 취소로 상쇄됨('취소됨' 명시 트리거). */
  cancelled: boolean;
}

/**
 * ★승인/취소 페어링(순수) — 동일 AUTHNO(원거래)로 묶인 거래들을 승인(0210) 1건 + 취소(0430) N건으로 분리.
 *   입력 rows 는 호출측이 auth_no 로 조회한 집합. tran_type 으로 leg 를 가르고 msg_trace(TRANSERIAL)로 취소 행을 정렬.
 *   승인이 없고 취소만 있는 비정상 케이스도 안전 반환(approval=null, cancels 유지) → UI 가 '승인건 미확인' 안내.
 */
export function pairApprovalCancel(rows: PayInfoAttempt[]): PayInfoLegs {
  const list = Array.isArray(rows) ? rows : [];
  const approval = list.find((r) => (r.tran_type ?? '').trim() === TRANTYPE_APPROVE) ?? null;
  const cancels = list
    .filter((r) => (r.tran_type ?? '').trim() === TRANTYPE_CANCEL)
    .sort((a, b) => (a.msg_trace ?? '').localeCompare(b.msg_trace ?? ''));
  return { approval, cancels, cancelled: cancels.length > 0 };
}

/** 최종상태 배지 문구 — 취소 존재 시 '취소됨', 그 외 '정상 승인'. */
export function payInfoNetStatusLabel(legs: PayInfoLegs): string {
  return legs.cancelled ? '취소됨' : '정상 승인';
}

/** 승인금액 = 응답 TAMT(raw.amount) 우선, 없으면 요청금액(requested_amount). 부모 모달과 동일 축. */
export function attemptAmount(a: PayInfoAttempt | null | undefined): number | null {
  if (!a) return null;
  return a.raw?.amount ?? a.requested_amount ?? null;
}
