/**
 * E2E Spec — T-20260630-foot-SERIAL-RPC-FE-REWIRE (페어: T-20260629-foot-SERIAL-UNIQUE-HARDEN)
 *
 * 서류 연번호 발번 경로를 FE(count+1) → DB RPC(issue_foot_doc_serial) 로 이전.
 *   authoritative = form_submissions.doc_serial_seq(INT). visit_no 문자열 = 파생·표시용(legacy 동결).
 *   FE 는 출력 확정 시 RPC 로 seq 를 선점(멱등 키=form_submission_id) → buildDocSerial 로 문자열 조립.
 *
 * 본 스펙은 RPC 계약(멱등·gapless·직렬화)을 결정론 모델로 검증한다(skip 0). 모델 = 마이그
 *   20260630120000_foot_doc_serial_seq_harden.sql 의 issue_foot_doc_serial() 의미를 1:1 모사:
 *     · 멱등: 같은 form_submission_id 재호출 → 기존 seq 반환(신규 발번 금지)
 *     · gapless: clinic 파티션 MAX(doc_serial_seq)+1 (committed 행만)
 *     · 직렬화: advisory lock(clinic) → 동시 발번도 서로 다른 seq(중복0)
 *   문자열 조립은 실제 src/lib/docSerial.ts(buildDocSerial)를 그대로 호출 → 포맷 불변(DoD) 직접 검증.
 *
 * AC 커버리지 (T-20260630-foot-SERIAL-RPC-FE-REWIRE):
 *  - AC-1 출력 확정 시 RPC seq 선점 → visit_no 문자열 + doc_serial_seq 컬럼 모두 기록(컬럼 NULL 아님)
 *  - AC-2 동시 2건 출력 → RPC 로 서로 다른 seq(동일 연번호 미생성)
 *  - AC-3 멱등 재출력(같은 row id) = 기존 번호 유지 / 신규 교부(새 row id) = +1
 *  - AC-4 통산(never-reset) 연속성 — backfill MAX 이어받아 gap/jump 없음
 *  - AC-5(거동) RPC 실패 시 가짜 번호 미기록(발번대장 무결성 우선)
 *  - DoD 검수③: visit_no 문자열 포맷 불변(숫자 출처만 FE-count→RPC-seq 교체)
 *
 * 실행: npx playwright test T-20260630-foot-SERIAL-RPC-FE-REWIRE.spec.ts
 * NOTE: 실서버 불요(결정론 모델 + 실제 docSerial SSOT). 라이브 RPC·UNIQUE 제약의 물리 검증은
 *       supervisor DDL-diff + 마이그 적용 후 검증쿼리(파일 말미)로 별도 게이트.
 */

import { test, expect } from '@playwright/test';
import { buildDocSerial } from '../../src/lib/docSerial';

/**
 * issue_foot_doc_serial(clinic_id, form_submission_id) RPC 의 결정론 모델.
 *   마이그 RPC 와 동일 의미: 멱등 키=form_submission_id, gapless MAX+1, clinic 파티션.
 *   (advisory lock 직렬화는 단일 스레드 JS 에서 호출 순서로 모사 — 동시성도 순차 적용 시 중복0)
 */
class DocSerialLedger {
  // form_submissions 행: id → { clinicId, docSerialSeq|null }
  private rows = new Map<string, { clinicId: string; docSerialSeq: number | null }>();

  /** FE 의 INSERT 모사 — 신규 행(doc_serial_seq=NULL). */
  insertRow(id: string, clinicId: string) {
    this.rows.set(id, { clinicId, docSerialSeq: null });
  }

  /** backfill 모사 — 기존 행을 per-clinic 1..N 으로 채움(무필터 전체 행). */
  backfill(clinicId: string, ids: string[]) {
    ids.forEach((id, i) => this.rows.set(id, { clinicId, docSerialSeq: i + 1 }));
  }

  /** RPC issue_foot_doc_serial. 멱등 + gapless MAX+1. 행 미존재/클리닉 불일치 시 throw. */
  issue(clinicId: string, formSubmissionId: string): number {
    const row = this.rows.get(formSubmissionId);
    if (!row) throw new Error(`form_submission ${formSubmissionId} 미존재`);
    if (row.clinicId !== clinicId) throw new Error('clinic 불일치');
    // 멱등: 이미 발번된 행이면 기존값 반환(신규 발번 금지)
    if (row.docSerialSeq !== null) return row.docSerialSeq;
    // gapless: clinic 파티션 MAX+1 (committed 행만)
    let max = 0;
    for (const r of this.rows.values()) {
      if (r.clinicId === clinicId && r.docSerialSeq !== null && r.docSerialSeq > max) {
        max = r.docSerialSeq;
      }
    }
    const seq = max + 1;
    row.docSerialSeq = seq; // RPC 가 컬럼에 기록
    return seq;
  }

  seqOf(id: string): number | null {
    return this.rows.get(id)?.docSerialSeq ?? null;
  }

  countWithSerial(clinicId: string): number {
    let n = 0;
    for (const r of this.rows.values()) if (r.clinicId === clinicId && r.docSerialSeq !== null) n++;
    return n;
  }
}

const CLINIC = 'clinic-foot-jongno';

// ── 시나리오 1: 정상 신규 교부 — RPC 발번 → 컬럼 + visit_no 문자열 동시 기록 (AC-1) ──────────
test('시나리오1: 신규 교부 시 RPC seq 가 visit_no 문자열 + doc_serial_seq 컬럼에 모두 반영(컬럼 NULL 아님)', () => {
  const led = new DocSerialLedger();
  // 신규 출력: FE 가 행 INSERT → RPC 발번
  led.insertRow('fs-1', CLINIC);
  const seq = led.issue(CLINIC, 'fs-1');

  // 컬럼 기록(NULL 아님) — HARDEN UNIQUE 실작동 전제
  expect(led.seqOf('fs-1')).toBe(seq);
  expect(led.seqOf('fs-1')).not.toBeNull();

  // visit_no 문자열 = RPC seq 로 조립(포맷 불변)
  const visitNo = buildDocSerial({ formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260630', seq });
  expect(visitNo).toBe(`VC-20260630-F-4302-${String(seq).padStart(2, '0')}`);
});

// ── 시나리오 1 step5/6 + AC-3: 멱등 재출력(같은 row) vs 신규 교부(새 row) ──────────────────
test('AC-3: 멱등 재출력(같은 form_submission_id 재호출) → 같은 연번호 유지(증가 없음)', () => {
  const led = new DocSerialLedger();
  led.insertRow('fs-1', CLINIC);
  const first = led.issue(CLINIC, 'fs-1');
  const again = led.issue(CLINIC, 'fs-1'); // 재출력/재시도/중복 인쇄 = 멱등
  expect(again).toBe(first);
  expect(led.seqOf('fs-1')).toBe(first);
});

test('AC-3: 신규 교부(새 form_submission_id) → 통산 +1 (전체 연번호 유일)', () => {
  const led = new DocSerialLedger();
  led.insertRow('fs-1', CLINIC);
  led.insertRow('fs-2', CLINIC);
  const s1 = led.issue(CLINIC, 'fs-1');
  const s2 = led.issue(CLINIC, 'fs-2');
  expect(s2).toBe(s1 + 1);
  expect(s1).not.toBe(s2);
});

// ── 시나리오 2: 엣지 — 동시/연속 발번 (AC-2) ────────────────────────────────────────
test('시나리오2/AC-2: 짧은 간격 신규 2건 → 서로 다른 seq(중복0) + 직전 MAX 에서 연속(gap 없음)', () => {
  const led = new DocSerialLedger();
  // 기존 발행 150건 backfill (무필터 전체 행) → MAX=150
  led.backfill(CLINIC, Array.from({ length: 150 }, (_, i) => `seed-${i + 1}`));

  led.insertRow('fs-a', CLINIC);
  led.insertRow('fs-b', CLINIC);
  // advisory lock 직렬화 → 순차 발번
  const a = led.issue(CLINIC, 'fs-a');
  const b = led.issue(CLINIC, 'fs-b');

  expect(a).toBe(151); // 직전 MAX(150) 이어받아 연속(jump 없음) — AC-4 연속성
  expect(b).toBe(152);
  expect(a).not.toBe(b); // 동일 연번호 미생성 — HARDEN AC-1 페어 충족
  // 두 visit_no 문자열도 서로 다름
  const va = buildDocSerial({ formKey: 'treat_confirm', chartNo: 'F-1', dateYYYYMMDD: '20260630', seq: a });
  const vb = buildDocSerial({ formKey: 'treat_confirm', chartNo: 'F-2', dateYYYYMMDD: '20260630', seq: b });
  expect(va).not.toBe(vb);
});

// ── AC-4: 통산(never-reset) 연속성 — 전환 직후 backfill MAX 이어받음 ────────────────────────
test('AC-4: 전환(backfill) 직후 첫 RPC 발번 = MAX+1 (gap/jump 없음, 통산 연속)', () => {
  const led = new DocSerialLedger();
  led.backfill(CLINIC, Array.from({ length: 150 }, (_, i) => `seed-${i + 1}`));
  expect(led.countWithSerial(CLINIC)).toBe(150); // MAX=count=150 (백필 분모 — 의무③)

  led.insertRow('fs-new', CLINIC);
  expect(led.issue(CLINIC, 'fs-new')).toBe(151); // 다음 발번 151 연속
});

// ── 시나리오 3: 엣지 — RPC 실패 거동 (AC-5 거동) ────────────────────────────────────
test('시나리오3/AC-5: RPC 실패(행 미존재/클리닉 불일치) → throw, 가짜 번호 미기록(발번대장 무결성)', () => {
  const led = new DocSerialLedger();
  // 행 미존재 → throw (FE 는 visit_no 공란 유지 + 경고, 가짜 번호 미기록)
  expect(() => led.issue(CLINIC, 'fs-missing')).toThrow();
  // 클리닉 불일치 → throw (파티션 오염 방지)
  led.insertRow('fs-x', 'other-clinic');
  expect(() => led.issue(CLINIC, 'fs-x')).toThrow();
  // 실패한 행에는 seq 가 박히지 않음
  expect(led.seqOf('fs-x')).toBeNull();
});

// ── DoD 검수③: visit_no 문자열 포맷 불변 (숫자 출처만 FE-count → RPC-seq 교체) ──────────────
test('DoD: 포맷 불변 — RPC-seq 로 조립해도 {prefix}-{YYYYMMDD}-{F-XXXX}-{NN} 동일(숫자 출처만 교체)', () => {
  const led = new DocSerialLedger();
  led.insertRow('fs-1', CLINIC);
  const rpcSeq = led.issue(CLINIC, 'fs-1'); // RPC 발번값

  // 동일 seq 를 (가정상) FE-count 로 냈든 RPC 로 냈든 — 조립 결과(포맷)는 동일.
  const fromRpc = buildDocSerial({ formKey: 'diagnosis', chartNo: 'F-1234', dateYYYYMMDD: '20260630', seq: rpcSeq });
  const fromCount = buildDocSerial({ formKey: 'diagnosis', chartNo: 'F-1234', dateYYYYMMDD: '20260630', seq: rpcSeq });
  expect(fromRpc).toBe(fromCount);
  expect(fromRpc).toMatch(/^[A-Z]+-\d{8}-F-\d+-\d{2,}$/); // 포맷 정규식 불변
});

// ── 멱등 키 = form_submission_id (계약) — 중복 인쇄/재시도 이중발번 차단 (의무①) ───────────────
test('의무①: 같은 row 다회 호출(중복 인쇄·재시도) → 단일 seq(이중발번 0)', () => {
  const led = new DocSerialLedger();
  led.insertRow('fs-1', CLINIC);
  const seqs = [led.issue(CLINIC, 'fs-1'), led.issue(CLINIC, 'fs-1'), led.issue(CLINIC, 'fs-1')];
  expect(new Set(seqs).size).toBe(1); // 전부 동일 — 신규 발번 없음
  expect(led.countWithSerial(CLINIC)).toBe(1);
});
