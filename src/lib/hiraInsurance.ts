// hiraInsurance — HIRA 약제급여목록 → prescription_codes 급여상태 매핑·병합 순수 로직
// Ticket: T-20260609-foot-HIRA-INSURANCE-BATCH Phase2 (parent: DRUG-INSURANCE-GATE Phase1)
//
// STEP1 조사 결과(2026-06-09): 약제급여목록 정본은 ★Open API 아님 → 월간 .xlsx 수동 다운로드+파싱.
//   배치(scripts/hira_insurance_sync.mjs)가 xlsx 를 읽어 claim_code(EDI/청구코드) 기준으로
//   prescription_codes.insurance_status 를 source='hira' 로 upsert 한다.
//   본 모듈은 그 변환·병합의 "순수 함수"만 담아 배치/FE/테스트가 공유한다(부수효과 없음).
//
// 매핑 키(AC2): HIRA 행의 청구코드(제품코드/EDI코드) ↔ prescription_codes.claim_code (NOT NULL UNIQUE).
//   주성분단축코드(ingredient_code)는 보조 — claim_code 우선.
//
// 우선순위 규칙(AC3): insurance_status_source='manual' 이고 값이 있으면 수동 override 가 HIRA 자동 갱신보다 우선.
//   배치는 manual row 를 보존(skip)하며, --force-overwrite-manual 시에만 덮는다.
//
// 삭제(deleted) 주의(STEP1): 약가마스터 매핑목록은 "급여삭제돼도 유지"되므로 단순 부재로 deleted 판정 금지.
//   → 본 모듈은 파일이 명시한 급여구분 텍스트가 있을 때만 deleted/criteria_changed 로 정규화한다.
//     급여구분 컬럼이 없는(=급여목록 존재만 의미하는) 파일은 covered 로 본다.

import type { InsuranceStatus } from '@/lib/prescriptionGate';

export type { InsuranceStatus };

/**
 * HIRA 파일의 급여구분 텍스트 → insurance_status enum 정규화.
 *
 * - 빈값/null → 'covered' (급여목록에 존재 = 급여로 간주; 파일에 별도 구분 컬럼이 없는 케이스)
 * - 한국어 표기 다양성 흡수: 급여/비급여/급여삭제(삭제)/급여기준변경(기준변경)
 * - 인식 불가 텍스트 → null (스킵 — 함부로 차단상태로 바꾸지 않음 = 안전)
 *
 * @param raw 파일 셀의 급여구분 텍스트 (없으면 covered 로 처리하도록 호출부에서 빈문자 전달)
 */
export function normalizeHiraStatus(raw: string | null | undefined): InsuranceStatus | null {
  const s = (raw ?? '').replace(/\s/g, '').trim();
  if (s === '') return 'covered'; // 급여목록 존재 = 급여
  // 비급여 (부분/전액 비급여 표기 모두 비급여로)
  if (/(비급여|전액본인|100\/100|100분의100)/.test(s)) return 'non_covered';
  // 급여삭제 / 삭제 / 등재취소 / 경과조치종료
  if (/(급여삭제|삭제|등재취소|경과조치종료|등재말소|말소)/.test(s)) return 'deleted';
  // 급여기준변경 / 기준변경 / 사용범위변경
  if (/(급여기준변경|기준변경|사용범위변경|적응증변경)/.test(s)) return 'criteria_changed';
  // 급여 / 등재 / 정상
  if (/(급여|등재|정상|유지)/.test(s)) return 'covered';
  return null; // 인식 불가 → 변경하지 않음(안전)
}

/** prescription_codes 측 현재 상태 스냅샷 */
export interface ExistingInsurance {
  insurance_status: string | null;
  insurance_status_source: string | null; // 'manual' | 'hira' | null
}

export type MergeAction =
  | 'update'        // 새 상태로 갱신(source='hira')
  | 'skip_manual'   // 수동 override 보존(AC3) — 갱신 안 함
  | 'noop'          // 동일 상태 — 변경 없음
  | 'skip_invalid'; // HIRA 상태 정규화 실패 — 변경 없음(안전)

export interface MergeDecision {
  action: MergeAction;
  /** action==='update' 일 때 적용할 상태 */
  nextStatus: InsuranceStatus | null;
}

/**
 * 단일 약품의 HIRA 갱신 병합 결정 (AC2·AC3 핵심 규칙).
 *
 * @param existing             prescription_codes 현재 상태/출처
 * @param hiraStatus           HIRA 파일에서 정규화된 상태(normalizeHiraStatus 결과)
 * @param forceOverwriteManual true 면 manual override 도 덮어씀(기본 false = 보존)
 */
export function resolveInsuranceMerge(
  existing: ExistingInsurance,
  hiraStatus: InsuranceStatus | null,
  forceOverwriteManual = false,
): MergeDecision {
  // HIRA 상태 인식 실패 → 절대 함부로 바꾸지 않는다(안전 — 차단상태 오염 방지).
  if (hiraStatus === null) return { action: 'skip_invalid', nextStatus: null };

  const curStatus = (existing.insurance_status ?? '').trim() || null;
  const curSource = (existing.insurance_status_source ?? '').trim() || null;

  // 수동 override 보존(AC3): manual 출처 + 값 존재 → 강제 옵션 없으면 skip.
  if (curSource === 'manual' && curStatus !== null && !forceOverwriteManual) {
    return { action: 'skip_manual', nextStatus: null };
  }

  // 동일 상태면 변경 불필요.
  if (curStatus === hiraStatus) return { action: 'noop', nextStatus: hiraStatus };

  return { action: 'update', nextStatus: hiraStatus };
}

/** 배치 1회 집계 결과(insurance_sync_runs 컬럼과 1:1) */
export interface SyncTally {
  total_rows: number;
  matched: number;
  updated: number;
  skipped_manual: number;
  skipped_nochange: number;
  unmatched: number;
}

export function emptyTally(): SyncTally {
  return { total_rows: 0, matched: 0, updated: 0, skipped_manual: 0, skipped_nochange: 0, unmatched: 0 };
}

/** MergeAction → SyncTally 카운터 반영(매칭된 row 한정; unmatched 는 호출부에서) */
export function applyDecisionToTally(tally: SyncTally, action: MergeAction): void {
  switch (action) {
    case 'update': tally.updated += 1; break;
    case 'skip_manual': tally.skipped_manual += 1; break;
    case 'noop': tally.skipped_nochange += 1; break;
    case 'skip_invalid': tally.skipped_nochange += 1; break;
  }
}
