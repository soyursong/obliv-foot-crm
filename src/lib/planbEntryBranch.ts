/**
 * planbEntryBranch.ts — 레드페이 플랜B §4-4(D절) 팝업 3분기 순수 판정
 * ────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-REDPAY-PLANB-V2-ADDENDUM-SPEC (최필경 총괄 v2 지시서 §4-4 D절)
 *
 * ★ 왜 별도 순수 모듈인가: 이 판정은 supabase(네트워크·클라이언트) 의존이 전혀 없는
 *   결정적 순수 함수이므로 planbExpectedAmount.ts 컨벤션대로 분리 → 단위 테스트가
 *   supabase 초기화 부수효과 없이 3분기를 직접 검증 가능. 서버 재조회(fetch)는
 *   paymentPlanb.ts(supabase 의존)가 담당하고 그 결과를 이 함수에 넘긴다.
 *
 * ★ D-2/D-3 배경(중복 결제 방지):
 *   새 버튼([카드 수납예정등록]) 경로는 등록→(차트에 수납 없는 구간, 최대 4분5초)→알림→수납생성.
 *   이 구간에 환자가 '미수납'으로 보여 실장 5명 환경에서 중복 등록→중복 결제→취소·환불 위험.
 *   방지 실주체는 (a) 서버 재조회(D-2, paymentPlanb.fetchPatientPlanbContext) 와
 *   (b) DB partial UNIQUE index pending_payment_open_uq (D-4) 이며,
 *   본 순수 판정은 재조회 결과 → 팝업 분기 라벨로 매핑하는 '경고+확인' UX 앞단이다.
 *   ※ 배지·화면 렌더 상태는 새로고침한 사람에게만 유효 → 중복방지 수단이 아니다(D-1).
 */

/** 클릭시 서버 재조회 결과 — 그 환자(방문)의 현재 결제 컨텍스트. UI 좌표 무관(데이터 전용). */
export interface PatientPlanbContext {
  /** 진행중(open) 선점 — 존재 시 D-3(a). 부분유니크(clinic,customer) WHERE open 으로 최대 1건. */
  openPending: {
    id: string;
    expected_amount: number;
    /** 등록한 담당자(D-5 ★필수 표시) — pending_payment.created_by. */
    created_by: string | null;
    created_at: string;
  } | null;
  /** 이 방문(check_in)의 활성 수납 — 존재 시 D-3(b). 취소·삭제(status≠active) 제외. */
  paidPayments: Array<{
    amount: number;
    created_at: string;
    /** 카드 승인번호(매처 자동부착 전이면 null → '카드 대조 대기' 배지, D-5). */
    external_approval_no: string | null;
  }>;
}

/** 팝업 3분기 라벨 — (a)has_open / (b)paid / (c)clear. */
export type PlanbEntryBranch = 'has_open' | 'paid' | 'clear';

/**
 * 팝업 3분기 순수 판정(D-3) — 재조회 컨텍스트 → 분기 라벨. 부수효과 없음(단위테스트 대상).
 *   우선순위: 진행중 선점(a) > 이미 수납(b) > 정상(c).
 *   ('진행중 선점'을 먼저 보는 이유 = 중복결제 위험의 직접 원인이 대기중 선점이므로.)
 */
export function resolvePlanbEntryBranch(ctx: PatientPlanbContext): PlanbEntryBranch {
  if (ctx.openPending) return 'has_open';
  if (ctx.paidPayments.length > 0) return 'paid';
  return 'clear';
}
