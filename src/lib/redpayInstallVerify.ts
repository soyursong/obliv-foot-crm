// T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY
// ──────────────────────────────────────────────────────────────
// 레드페이 대사 '설치검증 추정' net0 쌍 자동분류 — FE 소비측 순수 헬퍼(read-only).
//
// ★ 분류 판정 SSOT = 서버뷰 v_redpay_installverify_pairs (supabase/migrations/
//   20260803235500_foot_redpay_installverify_classify.sql). FE 는 뷰가 붙인
//   install_verify_presumed/install_verify_evidence 를 소비만 — 재판정 금지
//   (매처 진실원천 이중화 방지, 대사탭 §7 계약). 여기의 상수는 뷰 임계값 '미러'(표시/문안용).
//
// ── 자동 분류 4조건 (뷰가 ALL 충족 시에만 presumed=true) ─────────────────────────
//   ① 같은 TID·같은 금액·같은 승인번호 net-0 쌍(승인 Y + 즉시취소 N/X/M, 합=0)
//   ② 취소가 승인 후 '수십 초 내'(≤ IMMEDIATE_CANCEL_MAX_SEC)
//   ③ 해당 TID 거래가 그 쌍뿐(전체 이력 정확히 2건)
//   ④ 금액이 소액 whitelist
//   ⚠ 하나라도 미충족 → 미분류 → 기존 확인요청 플로우 유지.
//
// ── 안전 프레이밍(GO_WARN) ───────────────────────────────────────────────────────
//   '설치검증 추정' = 표시/triage 라벨일 뿐 거래 삭제·변경 아님(비파괴). 원본 데이터 무접촉.
//   언제든 필터로 재노출 + 사람 override 되돌림 가능. is_test/is_simulation(canonical)과 별도 축.

/** ② 승인→취소 '수십 초 내' 임계(초). 07-23 실측 17초. dev·총괄(최필경) 확정 임계 = 120s. */
export const IMMEDIATE_CANCEL_MAX_SEC = 120;

/** ④ 소액 whitelist(원). 근거: 07-23 1,004원 외 설치·단말 검증 관용 소액. dev·총괄 확정. */
export const SMALL_AMOUNT_WHITELIST: readonly number[] = [100, 500, 1000, 1004];

/** 서버뷰 install_verify_evidence(jsonb) 형태 — 4조건 근거(감사 추적). */
export interface InstallVerifyEvidence {
  classified?: string;                            // '설치검증_추정'
  cond1_net0_same_tid_amount_approval?: boolean;  // ① net0 쌍
  cond2_cancel_gap_sec?: number;                  // ② 취소 간격(초)
  cond2_threshold_sec?: number;                   // ② 임계(초)
  cond3_tid_txn_count?: number;                   // ③ TID 전체이력 거래수(=2)
  cond4_amount?: number;                          // ④ 금액
  approval_trxid?: string | null;
  cancel_trxid?: string | null;
  approval_at?: string | null;
  cancel_at?: string | null;
  approval_no?: string | null;
  tid?: string | null;
}

/** 대사행 최소 형태(뷰 컬럼) — presumed 판정 소비용. */
export interface InstallVerifyClassified {
  row_id: string;
  install_verify_presumed?: boolean | null;
  install_verify_evidence?: InstallVerifyEvidence | null;
}

/**
 * 행이 '설치검증 추정'으로 분류됐는지(서버뷰 판정 소비 + 세션 override 반영).
 * @param row       대사행
 * @param overridden 사람이 '설치검증 아님'으로 되돌린 row_id 집합(세션)
 */
export function isInstallVerifyPresumed(
  row: InstallVerifyClassified,
  overridden?: ReadonlySet<string>,
): boolean {
  if (overridden?.has(row.row_id)) return false; // 사람 override → 기존 플로우 복귀
  return row.install_verify_presumed === true;
}

/**
 * 설치검증 추정 건수(요약용 N). override 반영. 순수 함수(집계).
 * ★ 아침요약/대사탭 요약줄의 'N건' 단일 소스. 개별 확인요청 억제 대상 수.
 */
export function countInstallVerifyPresumed(
  rows: InstallVerifyClassified[],
  overridden?: ReadonlySet<string>,
): number {
  return rows.filter((r) => isInstallVerifyPresumed(r, overridden)).length;
}

/** 4조건 evidence → 현장 친화 근거 문구 배열(개발용어 배제, 대사화면 '분류 사유' 표시). */
export function describeEvidence(ev: InstallVerifyEvidence | null | undefined): string[] {
  if (!ev) return [];
  const lines: string[] = [];
  lines.push('① 같은 단말기·같은 금액·같은 승인번호로 승인 즉시 취소(순액 0원)');
  if (typeof ev.cond2_cancel_gap_sec === 'number') {
    lines.push(`② 승인 ${ev.cond2_cancel_gap_sec}초 만에 취소(수십 초 내)`);
  }
  if (typeof ev.cond3_tid_txn_count === 'number') {
    lines.push(`③ 이 단말기(${ev.tid ?? '-'})에는 이 승인·취소 한 쌍만 있음(단독)`);
  }
  if (typeof ev.cond4_amount === 'number') {
    lines.push(`④ 금액이 소액(${ev.cond4_amount.toLocaleString('ko-KR')}원)`);
  }
  return lines;
}
