/**
 * E2E/Unit — T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX
 *
 * 현장 근본원인(부모 진단 T-20260805-...-DIAG, deployed 03f49568):
 *   PaymentMiniWindow 오픈 로드 재구성(svcs.find(s.id===ci.service_id))이 활성 서비스 매칭분만
 *   selectedItems 로 복원 → 매칭실패(비활성/NULL service_id) 라인을 else 없이 silent drop.
 *   재저장(saveCheckInServices / handleClose = DELETE-all→reinsert)이 그 라인을 영구 소멸 →
 *   payments(별 grain) alive 잔존 → 결제-라인 unlink + cis 영구손실. (카테고리 무관.)
 *
 * FIX(preserve-reinsert): DELETE 前 full snapshot 을 3-way MECE partition(cisPreserve SSOT) →
 *   orphan(B2)·voided(B3) 라인을 verbatim preserve-reinsert. B1(활성+exam-marker)은 기존 rebuild.
 *
 * DA SSOT: da_replies/da_decision_foot_chartresave_cis_preserve_reinsert_20260805.md (GO 조건부).
 *   census(HARD): cis.id FK confrelid=0 · app-level 영속참조 0(KOH RPC = ephemeral read-then-act) →
 *   new-PK 재삽입 안전(current-behavior evidence). MECE verify-gate + voided_at-absence-robust.
 *
 * ⚠ 본 spec 은 프로덕션이 실제 호출하는 SSOT 순수 함수(partitionCisSnapshot/assertPartitionMece)를
 *    그대로 검증한다(안티패턴 회피 — 실제 persist 경로의 partition 을 결정적으로 재현).
 * ⛔ 순수 함수 read-only 검증. 어떤 값도 DB write/승격 없음.
 */
import { test, expect } from '@playwright/test';
import {
  partitionCisSnapshot,
  assertPartitionMece,
  isExamMarkerRow,
  toPreserveRow,
  type CisSnapshotRow,
} from '../../src/lib/cisPreserve';
import { applyExamFlagsToReinsert, type CisInsertRow } from '../../src/lib/examFlagPreserve';

const CI = 'c0000000-0000-0000-0000-0000000000aa';
// 활성 서비스 집합(= load 재구성 svcs). ACT1/ACT2 만 활성. INACT/NULL 은 매칭실패.
const ACTIVE = new Set(['ACT1', 'ACT2']);

const row = (o: Partial<CisSnapshotRow>): CisSnapshotRow => ({
  check_in_id: CI,
  service_id: null,
  service_name: '',
  price: 0,
  original_price: 0,
  is_package_session: false,
  package_session_id: null,
  ...o,
});

test.describe('T-20260805 preserve-reinsert — 재저장 시 매칭실패(orphan) 라인 소멸 봉합', () => {
  test('AC-1: 비활성 service_id 경제 라인 = B2 orphan preserve (silent-drop 봉합)', () => {
    const snap = [
      row({ id: '1', service_id: 'ACT1', service_name: '레이저', price: 30000, original_price: 30000 }),
      row({ id: '2', service_id: 'INACT', service_name: '풋화장품', price: 45000, original_price: 45000 }),
    ];
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.orphanRows.length).toBe(1); // 비활성 화장품 라인 preserve
    expect(p.orphanRows[0].service_name).toBe('풋화장품');
    expect(p.orphanRows[0].price).toBe(45000);
    expect(p.liveOrRebuiltCount).toBe(1); // 활성 레이저 = B1 rebuild
    expect(p.voidedRows.length).toBe(0);
  });

  test('AC-1b: NULL service_id 경제 라인(수기) = B2 orphan preserve', () => {
    const snap = [row({ id: '3', service_id: null, service_name: '수기항목', price: 12000, original_price: 12000 })];
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.orphanRows.length).toBe(1);
    expect(p.orphanRows[0].service_id).toBeNull();
  });

  test('AC-2: exam-marker(service_id NULL & price 0) = B2 제외(applyExamFlagsToReinsert 재구성 위임) → 이중삽입 0', () => {
    // prod census: NULL service_id 2행 전부 = 'KOH 진균검사(요청)' 마커(price 0). preserve 하면 마커 중복.
    const snap = [
      row({ id: '4', service_id: null, service_name: 'KOH 진균검사(요청)', price: 0, original_price: 0, koh_requested: true }),
      row({ id: '5', service_id: null, service_name: 'KOH 진균검사(요청)', price: 0, original_price: 0, koh_requested: false }),
    ];
    expect(isExamMarkerRow(snap[0])).toBe(true);
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.orphanRows.length).toBe(0); // 마커는 preserve 안 함
    expect(p.liveOrRebuiltCount).toBe(2); // B1(재구성 위임)
  });

  test('AC-2b: orphan KOH 라인 + koh 플래그 → applyExamFlagsToReinsert 결합 적용 시 KOH 마커 이중생성 0', () => {
    // 비활성 KOH *서비스* 라인(service_id 有) = orphan preserve. examFlag 결합적용이 마커를 추가로 안 만든다.
    const snap = [row({ id: '6', service_id: 'INACT', service_name: 'KOH 진균검사', price: 20000, original_price: 20000, koh_requested: true })];
    const p = partitionCisSnapshot(snap, ACTIVE);
    const rows: CisInsertRow[] = [...p.orphanRows]; // B1 없음(활성 0)
    applyExamFlagsToReinsert(rows, CI, { blood: false, koh: true });
    const kohRows = rows.filter((r) => r.koh_requested === true);
    expect(kohRows.length).toBe(1); // orphan KOH 라인 1개만 — 마커 추가 없음(이중 0)
  });

  test('AC-3 MECE: 완전분할(exclusive+exhaustive) — sum == snapshotTotal', () => {
    const snap = [
      row({ id: '1', service_id: 'ACT1', price: 1000, original_price: 1000 }),
      row({ id: '2', service_id: 'INACT', price: 2000, original_price: 2000 }),
      row({ id: '3', service_id: null, price: 3000, original_price: 3000 }),
      row({ id: '4', service_id: null, service_name: 'KOH 진균검사(요청)', price: 0, original_price: 0 }),
    ];
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(assertPartitionMece(p)).toBe(true);
    expect(p.liveOrRebuiltCount + p.orphanRows.length + p.voidedRows.length).toBe(snap.length);
    expect(p.orphanRows.length).toBe(2); // INACT + NULL경제
    expect(p.liveOrRebuiltCount).toBe(2); // ACT1 + 마커
  });

  test('AC-4 멱등: 이미 orphan 없는(재저장 완료) snapshot → preserve 0', () => {
    const snap = [row({ id: '1', service_id: 'ACT1', price: 1000, original_price: 1000 })];
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.orphanRows.length).toBe(0);
    expect(p.voidedRows.length).toBe(0);
  });

  test('AC-5 voided_at-absence-robust: voided_at 키 부재(prod HELD) → B3=∅, 전 orphan preserve', () => {
    // select('*') 결과에 voided_at 컬럼 자체가 없음(키 미존재).
    const snap: CisSnapshotRow[] = [
      { check_in_id: CI, service_id: 'INACT', service_name: '풋화장품', price: 45000, original_price: 45000 },
    ];
    expect('voided_at' in snap[0]).toBe(false);
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.voidedRows.length).toBe(0); // B3=∅
    expect(p.orphanRows.length).toBe(1); // 전 orphan preserve
    expect('voided_at' in p.orphanRows[0]).toBe(false); // 컬럼 부재 → INSERT 시 42703 회피
  });

  test('AC-6 voided carry-forward: voided_at 실재(soft-void 착지) → B3 preserve + voided_at 보존', () => {
    const snap = [
      { ...row({ id: '7', service_id: 'ACT1', price: 1000, original_price: 1000 }), voided_at: '2026-08-05T10:00:00Z', voided_reason: '오정정', voided_by: 'staff-1' },
      row({ id: '8', service_id: 'INACT', price: 2000, original_price: 2000, voided_at: null }),
    ];
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.voidedRows.length).toBe(1); // voided_at NOT NULL 행 우선 → B3
    expect((p.voidedRows[0] as Record<string, unknown>).voided_at).toBe('2026-08-05T10:00:00Z');
    expect((p.voidedRows[0] as Record<string, unknown>).voided_reason).toBe('오정정');
    expect(p.orphanRows.length).toBe(1); // voided_at NULL 비활성 = B2 orphan
  });

  test('AC-7 new-PK: preserve 행은 id/created_at 미포함(신규 PK 발번 대상)', () => {
    const r = toPreserveRow(row({ id: 'OLD-PK', service_id: 'INACT', service_name: 'x', price: 100, original_price: 100 }));
    expect('id' in r).toBe(false);
    expect('created_at' in r).toBe(false);
  });

  test('AC-8: seller_staff_id·package_session_id verbatim carry(귀속·회차 보존)', () => {
    const snap = [row({ id: '9', service_id: 'INACT', service_name: '풋화장품', price: 45000, original_price: 45000, seller_staff_id: 'seller-9', is_package_session: true, package_session_id: 'ps-9' })];
    const p = partitionCisSnapshot(snap, ACTIVE);
    expect(p.orphanRows[0].seller_staff_id).toBe('seller-9');
    expect(p.orphanRows[0].package_session_id).toBe('ps-9');
    expect(p.orphanRows[0].is_package_session).toBe(true);
  });
});
