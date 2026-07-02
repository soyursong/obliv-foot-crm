/**
 * E2E Spec — T-20260629-foot-SERIAL-UNIQUE-HARDEN (페어: T-20260630-foot-SERIAL-RPC-FE-REWIRE)
 *
 * 서류 연번호 동시발번 중복 차단 — doc_serial_seq INT + backfill + RPC + partial UNIQUE INDEX.
 *
 * ★최종 정본 = DA re-CONSULT#3-AMENDMENT LEAVENULL-4 (CONSULT-REPLY MSG-20260702-173946-fdqy,
 *   decision_id DA-20260702-FOOT-SERIAL-LEAVENULL-4, 2026-07-02 17:39 KST).
 *   OPT1(발번 immutable guard 화이트리스트)·OPT4(side-table form_submission_serials) 모두 supersede.
 *   결정적 사실: RPC 는 printed 행만 UPDATE(발번 모멘트=printed 전이) → published guard 미해당 →
 *     런타임 절대 차단 없음. 차단되는 건 오직 1회성 backfill 의 published 행뿐 → backfill 을
 *     non-published 한정으로 교정하면 의료 immutable guard(trg_form_submissions_published_immutable)
 *     무접촉으로 목표 달성.
 *
 * 본 스펙은 마이그 20260630120000_foot_doc_serial_seq_harden.sql 의 LEAVENULL-4 backfill/assert 의미를
 *   결정론 모델로 검증한다(skip 0, 실서버 불요). 검증 항목:
 *     · backfill non-published 한정: published 행 doc_serial_seq = NULL 잔존(guard 42501 회피)
 *     · non-published gapless: per-clinic 1..N(published 갭 없음)
 *     · assert 재정의: MAX(doc_serial_seq) = COUNT(*) FILTER(doc_serial_seq IS NOT NULL) per-clinic
 *     · RPC 발번식 MAX+1(committed·NULL 제외) → published NULL 행이 다음 발번 점프/충돌 유발 안 함
 *     · published 행 무-mutation(RPC 미호출 대상 = 발번 모멘트가 printed 전이라 published 미해당)
 *
 * 라이브 RPC·partial UNIQUE·의료 immutable guard 무접촉의 물리 검증은 supervisor DDL-diff +
 *   마이그 적용 후 검증쿼리(apply 스크립트 VERIFY: max_eq_issued=true, published_seq_nonnull=0)로 별도 게이트.
 *
 * 실행: npx playwright test T-20260629-foot-SERIAL-UNIQUE-HARDEN.spec.ts
 */

import { test, expect } from '@playwright/test';

type Status = 'printed' | 'signed' | 'published' | 'voided';

/**
 * LEAVENULL-4 마이그 의미의 결정론 모델.
 *   backfill: WHERE status <> 'published' 한정 → ranked 도 non-published 위에서 계산(gapless).
 *   RPC issue_foot_doc_serial: MAX+1(committed·NULL 제외), 멱등 키=form_submission_id.
 *   published 행은 immutable guard 로 UPDATE 불가 → RPC 는 발번 모멘트(printed 전이)에서만 호출되므로 미해당.
 */
class LeaveNullMigrationModel {
  // form_submissions 행: id → { clinicId, status, docSerialSeq|null, createdAt }
  private rows = new Map<
    string,
    { clinicId: string; status: Status; docSerialSeq: number | null; createdAt: number }
  >();

  seedRow(id: string, clinicId: string, status: Status, createdAt: number) {
    this.rows.set(id, { clinicId, status, docSerialSeq: null, createdAt });
  }

  /**
   * LEAVENULL-4 backfill: non-published 한정, per-clinic row_number(created_at,id) 1..N.
   *   published 행은 건드리지 않는다(guard 42501 회피) → doc_serial_seq NULL 잔존.
   */
  backfill(clinicId: string) {
    const nonPublished = [...this.rows.entries()]
      .filter(([, r]) => r.clinicId === clinicId && r.status !== 'published')
      .sort((a, b) => a[1].createdAt - b[1].createdAt || a[0].localeCompare(b[0]));
    nonPublished.forEach(([id], i) => {
      this.rows.get(id)!.docSerialSeq = i + 1; // gapless 1..N (published 갭 없음)
    });
    // published 행은 의도적으로 미변경(NULL 잔존).
  }

  /** guard 모사: published 행 UPDATE 시도 = 42501 차단(마이그·런타임 공통 불변식). */
  private assertGuard(id: string) {
    const r = this.rows.get(id)!;
    if (r.status === 'published') {
      throw new Error('42501: published 행 immutable guard — UPDATE 차단');
    }
  }

  /**
   * RPC issue_foot_doc_serial 모사. 발번 모멘트=printed 전이(published 미해당).
   *   MAX+1(committed·NULL 제외) + 멱등(이미 발번 시 기존값). published 행 호출은 guard throw.
   */
  issue(clinicId: string, id: string): number {
    const row = this.rows.get(id);
    if (!row) throw new Error(`form_submission ${id} 미존재`);
    if (row.clinicId !== clinicId) throw new Error('clinic 불일치');
    if (row.docSerialSeq !== null) return row.docSerialSeq; // 멱등
    this.assertGuard(id); // published 이면 여기서 throw (런타임에선 발생 안 함 — printed 전이만 발번)
    let max = 0;
    for (const r of this.rows.values()) {
      if (r.clinicId === clinicId && r.docSerialSeq !== null && r.docSerialSeq > max) max = r.docSerialSeq;
    }
    row.docSerialSeq = max + 1;
    return row.docSerialSeq;
  }

  seqOf(id: string): number | null {
    return this.rows.get(id)?.docSerialSeq ?? null;
  }

  /** assert: MAX(doc_serial_seq) — NULL 제외 (마이그 3-a 모사). */
  maxSeq(clinicId: string): number {
    let max = 0;
    for (const r of this.rows.values()) {
      if (r.clinicId === clinicId && r.docSerialSeq !== null && r.docSerialSeq > max) max = r.docSerialSeq;
    }
    return max;
  }

  /** assert: COUNT(*) FILTER(doc_serial_seq IS NOT NULL) per-clinic. */
  issuedCount(clinicId: string): number {
    let n = 0;
    for (const r of this.rows.values()) if (r.clinicId === clinicId && r.docSerialSeq !== null) n++;
    return n;
  }

  /** published 행 중 seq 가 채워진(NULL 아님) 개수 = 0 이어야 함. */
  publishedNonNull(clinicId: string): number {
    let n = 0;
    for (const r of this.rows.values())
      if (r.clinicId === clinicId && r.status === 'published' && r.docSerialSeq !== null) n++;
    return n;
  }
}

const CLINIC = '74967aea-0000-0000-0000-000000000001';

/** prod 실측 분포 재현: printed63/signed9/published7/voided5 = 84행(단일 clinic). */
function seedProdLike(m: LeaveNullMigrationModel) {
  let t = 0;
  const add = (status: Status, count: number) => {
    for (let i = 0; i < count; i++) m.seedRow(`${status}-${i}`, CLINIC, status, t++);
  };
  add('printed', 63);
  add('signed', 9);
  add('published', 7);
  add('voided', 5);
}

// ── 시나리오1: backfill non-published 한정 → published 7행 seq NULL 잔존 (LEAVENULL-4 핵심) ──────
test('시나리오1: backfill 후 published 행은 doc_serial_seq NULL 잔존(guard 42501 회피)', () => {
  const m = new LeaveNullMigrationModel();
  seedProdLike(m);
  m.backfill(CLINIC);

  // published 7행 전부 NULL (backfill 미대상)
  expect(m.publishedNonNull(CLINIC)).toBe(0);
  for (let i = 0; i < 7; i++) expect(m.seqOf(`published-${i}`)).toBeNull();
});

// ── 시나리오2: non-published gapless 1..N (published 갭 없음) ──────────────────────────────────
test('시나리오2: non-published 행은 1..N gapless — published 갭이 발번 순번을 비우지 않음', () => {
  const m = new LeaveNullMigrationModel();
  seedProdLike(m);
  m.backfill(CLINIC);

  const nonPublishedCount = 63 + 9 + 5; // printed+signed+voided = 77
  const seqs = [
    ...Array.from({ length: 63 }, (_, i) => m.seqOf(`printed-${i}`)),
    ...Array.from({ length: 9 }, (_, i) => m.seqOf(`signed-${i}`)),
    ...Array.from({ length: 5 }, (_, i) => m.seqOf(`voided-${i}`)),
  ].filter((s): s is number => s !== null);

  // 발번행 = 77, 값 집합 = {1..77} 정확히(gap/중복 0)
  expect(seqs.length).toBe(nonPublishedCount);
  const sorted = [...seqs].sort((a, b) => a - b);
  expect(sorted[0]).toBe(1);
  expect(sorted[sorted.length - 1]).toBe(nonPublishedCount);
  expect(new Set(seqs).size).toBe(nonPublishedCount); // 중복0
});

// ── 시나리오3: assert 재정의 — MAX(doc_serial_seq) = COUNT(NOT NULL) per-clinic ────────────────
test('시나리오3: assert 재정의 통과 — MAX(doc_serial_seq)=발번행수(NOT NULL), published NULL 제외', () => {
  const m = new LeaveNullMigrationModel();
  seedProdLike(m);
  m.backfill(CLINIC);

  // ★LEAVENULL-4 핵심 불변식: 원 assert(MAX=count(*)=84)는 FAIL, 재정의(MAX=count NOT NULL=77)는 PASS
  expect(m.maxSeq(CLINIC)).toBe(77);
  expect(m.issuedCount(CLINIC)).toBe(77);
  expect(m.maxSeq(CLINIC)).toBe(m.issuedCount(CLINIC)); // 재정의 assert PASS
  expect(m.maxSeq(CLINIC)).not.toBe(84); // 전체행 84 ≠ 발번행 77 (published 7 제외)
});

// ── 시나리오4: RPC 발번식 MAX+1(NULL 제외) → published NULL 행이 점프/충돌 유발 안 함 ────────────
test('시나리오4: backfill 후 첫 신규 발번 = MAX+1 = 78 (published NULL 7행이 gap/jump 유발 안 함)', () => {
  const m = new LeaveNullMigrationModel();
  seedProdLike(m);
  m.backfill(CLINIC);

  // 신규 printed 행 발번 → 77+1 = 78 (published 7행 NULL 은 MAX 계산에서 제외되어 무영향)
  m.seedRow('new-printed-1', CLINIC, 'printed', 999);
  expect(m.issue(CLINIC, 'new-printed-1')).toBe(78);

  // 연속 발번도 gapless
  m.seedRow('new-printed-2', CLINIC, 'printed', 1000);
  expect(m.issue(CLINIC, 'new-printed-2')).toBe(79);
});

// ── 시나리오5: 멱등 — 같은 행 재발번 시 기존값 유지(이중발번 0) ────────────────────────────────
test('시나리오5: 멱등 재출력(같은 form_submission_id) → 같은 연번호 유지(증가 없음)', () => {
  const m = new LeaveNullMigrationModel();
  seedProdLike(m);
  m.backfill(CLINIC);
  m.seedRow('new-printed-1', CLINIC, 'printed', 999);

  const first = m.issue(CLINIC, 'new-printed-1');
  const second = m.issue(CLINIC, 'new-printed-1');
  expect(second).toBe(first); // 멱등 — 이중발번 0
});

// ── 시나리오6: 런타임 안전 — 발번 모멘트=printed 전이라 published 는 RPC 미해당(guard 무충돌) ────
test('시나리오6: 런타임 RPC 는 printed 행만 발번 → published guard 42501 미발생(런타임 절대 차단 없음)', () => {
  const m = new LeaveNullMigrationModel();
  seedProdLike(m);
  m.backfill(CLINIC);

  // printed 행 발번 = 정상(guard 무해당)
  m.seedRow('runtime-printed', CLINIC, 'printed', 2000);
  expect(() => m.issue(CLINIC, 'runtime-printed')).not.toThrow();

  // 만약(비정상 경로로) published 행에 RPC 가 호출되면 guard 가 차단 — 불변식 방어 확인.
  // ※ 실제 런타임에선 발번 모멘트가 printed 전이이므로 이 경로는 발생하지 않음(LEAVENULL-4 결정적 사실).
  m.seedRow('rogue-published', CLINIC, 'published', 2001);
  expect(() => m.issue(CLINIC, 'rogue-published')).toThrow(/42501/);
});

// ── 시나리오7: 전량-published clinic(엣지) → MAX=0, issued=0 → assert 0=0 PASS ──────────────────
test('엣지: 발번대상 0(전량 published) clinic → COALESCE(MAX,0)=0=issued(0), assert PASS', () => {
  const m = new LeaveNullMigrationModel();
  const EDGE = 'edge-clinic-all-published';
  for (let i = 0; i < 3; i++) m.seedRow(`ep-${i}`, EDGE, 'published', i);
  m.backfill(EDGE);

  expect(m.maxSeq(EDGE)).toBe(0); // COALESCE(MAX,0)
  expect(m.issuedCount(EDGE)).toBe(0);
  expect(m.maxSeq(EDGE)).toBe(m.issuedCount(EDGE)); // 0=0 PASS (거짓 FAIL 없음)
  expect(m.publishedNonNull(EDGE)).toBe(0);
});
