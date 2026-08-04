// cisPreserve — check_in_services 재저장(DELETE-all→reinsert) 시 매칭실패(orphan)·voided 라인
//   preserve-reinsert 순수 로직 SSOT.
// Ticket: T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX
// DA SSOT: da_replies/da_decision_foot_chartresave_cis_preserve_reinsert_20260805.md (GO 조건부)
//
// [지배 RC] PaymentMiniWindow 오픈 시 로드 재구성(L1288: svcs.find(s.id===ci.service_id))이
//   활성 서비스 매칭분만 selectedItems 로 복원하고 매칭실패분(비활성/NULL service_id)을 else 없이
//   silent drop → 재저장(DELETE-all→reinsert)이 그 라인을 영구 소멸. payments(별 grain)는 alive
//   잔존 → 결제-라인 unlink + cis 영구손실. (카테고리 무관 — 화장품 국한 아님.)
//
// [해소 = forward-seal] DELETE 前 full snapshot 을 3-way MECE partition 하여, load 재구성이 버린
//   orphan(B2)·voided(B3) 라인을 verbatim preserve-reinsert 한다(examFlag/package_session C3 보존과
//   동일 패턴의 확장). B1(활성 매칭 + exam-marker)은 기존대로 selectedItems/examFlag 로 rebuild.
//
// [MECE 불변식] 각 snapshot 행 = B1 XOR B2 XOR B3 (if/elif/else 완전분할).
//   · orphan(B2) 술어 = load 재구성 drop 술어(svcs.find 실패)의 정확한 역 → double-insert/gap 0.
//   · B2 는 exam-marker(service_id NULL & price/original 0 — applyExamFlagsToReinsert 가 재구성)를
//     제외한다 → KOH/피검사 마커 phantom 중복 삽입 0. (prod census: NULL service_id 2행 전부 마커.)
//   · voided(B3)=voided_at IS NOT NULL 우선 판정 → soft-void 감사행 voided_at carry-forward 보존.
//
// [voided_at-absence-robust] soft-void 컬럼(voided_at/voided_reason/voided_by)은 prod 미실재(mig
//   20260805110000 HELD). snapshot 을 select('*') 로 읽으면 컬럼 부재 시 키 자체가 없다 → voided 판정
//   항상 false → B3=∅, 전 orphan 은 B2 로 preserve. ∴ 긴급 forward-seal 을 HELD soft-void mig 에서
//   DECOUPLE — 지금 착지해 40 alive 행 보호. (DA Q2-(1))
//
// no-DDL — 기존 컬럼만 사용(voided_* 는 실재 시에만 conditional carry). 프로덕션·E2E 공용 SSOT.

import type { CisInsertRow } from './examFlagPreserve';

/** DELETE 前 full snapshot 의 한 행. select('*') 결과 — voided_* 는 컬럼 실재 시에만 키가 존재. */
export interface CisSnapshotRow {
  id?: string;
  check_in_id?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  price?: number | null;
  original_price?: number | null;
  is_package_session?: boolean | null;
  package_session_id?: string | null;
  seller_staff_id?: string | null;
  blood_test_requested?: boolean | null;
  koh_requested?: boolean | null;
  koh_nail_sites?: unknown;
  voided_at?: string | null;
  voided_reason?: string | null;
  voided_by?: string | null;
}

export interface CisPartitionResult {
  /** B2 orphan(비활성/NULL service_id · 非exam-marker · voided_at IS NULL) — verbatim preserve-reinsert. */
  orphanRows: CisInsertRow[];
  /** B3 voided(voided_at IS NOT NULL) — voided_* carry-forward preserve. soft-void 착지 후에만 non-empty. */
  voidedRows: CisInsertRow[];
  /** B1 = 활성 매칭(selectedItems rebuild) + exam-marker(applyExamFlagsToReinsert 재구성). 여기선 count 만. */
  liveOrRebuiltCount: number;
  /** MECE assert 용: snapshot 총 행수. liveOrRebuiltCount + orphan + voided 와 반드시 일치. */
  snapshotTotal: number;
}

/**
 * exam-marker = applyExamFlagsToReinsert 가 재생성하는 순수 플래그 캐리어 행.
 *   service_id NULL & price 0 & original_price 0 (경제가치 0). preserve 시 examFlag 재구성과 중복 →
 *   B2 에서 제외(B1 로 흡수, 재구성 위임). prod census: NULL service_id 2행 = 'KOH 진균검사(요청)' 마커.
 */
export const isExamMarkerRow = (r: CisSnapshotRow): boolean =>
  r.service_id == null && (r.price ?? 0) === 0 && (r.original_price ?? 0) === 0;

/** snapshot 행 → preserve-reinsert 용 CisInsertRow(신규 PK 발번 대상 — id/created_at 미포함, verbatim carry). */
export function toPreserveRow(r: CisSnapshotRow): CisInsertRow {
  const row: CisInsertRow = {
    check_in_id: r.check_in_id as string,
    service_id: r.service_id ?? null,
    service_name: r.service_name ?? '',
    price: r.price ?? 0,
    original_price: r.original_price ?? r.price ?? 0,
    is_package_session: r.is_package_session === true,
    package_session_id: r.package_session_id ?? null,
    seller_staff_id: r.seller_staff_id ?? null,
    blood_test_requested: r.blood_test_requested === true,
    koh_requested: r.koh_requested === true,
  };
  // koh_nail_sites = 실재 컬럼 → verbatim carry(있을 때만, undefined 는 미주입).
  if (r.koh_nail_sites !== undefined) {
    (row as Record<string, unknown>).koh_nail_sites = r.koh_nail_sites;
  }
  // voided_* = soft-void 착지 후에만 실재. 컬럼 부재 prod 에 INSERT 시 42703 → 'voided_at' in r 로 conditional.
  if ('voided_at' in r) {
    (row as Record<string, unknown>).voided_at = r.voided_at ?? null;
    (row as Record<string, unknown>).voided_reason = r.voided_reason ?? null;
    (row as Record<string, unknown>).voided_by = r.voided_by ?? null;
  }
  return row;
}

/**
 * pre-DELETE snapshot 을 3-way MECE partition.
 *   B3 voided(voided_at != null) 우선 → B1 live(활성 svcs) or exam-marker → else B2 orphan.
 * @param snapshot         DELETE 前 check_in_services select('*') 전체 행.
 * @param activeServiceIds 현재 활성 services.id 집합(= load 재구성 svcs 와 동일 predicate SSOT).
 */
export function partitionCisSnapshot(
  snapshot: CisSnapshotRow[],
  activeServiceIds: Set<string>,
): CisPartitionResult {
  const orphanRows: CisInsertRow[] = [];
  const voidedRows: CisInsertRow[] = [];
  let liveOrRebuiltCount = 0;
  for (const r of snapshot) {
    const isVoided = r.voided_at != null; // B3 (absence-robust: undefined/null → false)
    const isLive = r.service_id != null && activeServiceIds.has(r.service_id);
    if (isVoided) {
      voidedRows.push(toPreserveRow(r)); // B3
    } else if (isLive || isExamMarkerRow(r)) {
      liveOrRebuiltCount++; // B1 — selectedItems rebuild / applyExamFlagsToReinsert 재구성
    } else {
      orphanRows.push(toPreserveRow(r)); // B2 — 진성 economic orphan preserve
    }
  }
  return { orphanRows, voidedRows, liveOrRebuiltCount, snapshotTotal: snapshot.length };
}

/** MECE 완전분할 검증(defensive) — liveOrRebuilt + orphan + voided === snapshotTotal 이면 true. */
export function assertPartitionMece(p: CisPartitionResult): boolean {
  return p.liveOrRebuiltCount + p.orphanRows.length + p.voidedRows.length === p.snapshotTotal;
}
