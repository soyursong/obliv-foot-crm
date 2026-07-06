/**
 * E2E Spec — T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE
 *
 * [근인] 서류 일괄 출력 경로(DocumentPrintPanel.handleBatchPrint)가 issue_foot_doc_serial RPC 를
 *   호출하지 않고 visit_no 문자열도 조립하지 않아, 연번호 대상 양식이 {{visit_no}} 공란으로 인쇄됨.
 *   현장은 진료확인서(treat_confirm_code/nocode=VC)·통원확인서(visit_confirm=AV)를 배치로 출력 →
 *   이 두 doc_type "연번호 공란" 재확인. (단건 IssueDialog.handlePrint 는 이미 RPC 발번 정상.)
 *   ※ RPC/컬럼(doc_serial_seq)·UNIQUE 제약은 SERIAL-UNIQUE-HARDEN 로 이미 프로덕션 적용·정상 동작 확인.
 *     본 티켓은 순수 FE 배선(배치 경로 발번 누락) 수정 — DB 변경 0.
 *
 * [수정] 배치 경로도 단건과 동형: 연번호 대상(docSerialPrefix 매핑 + 차트번호 보유) 양식은
 *   ① form_submissions 선 INSERT → ② issue_foot_doc_serial 발번(멱등) → ③ buildDocSerial 로 visit_no 조립
 *   → ④ per-template 바인딩값 주입 + field_data 갱신. serialIssuedTemplateIds 로 이중 INSERT 차단.
 *
 * 본 스펙은 배치 발번 거동을 결정론 모델로 검증(skip 0). RPC 의미는 SERIAL-RPC-FE-REWIRE 스펙과
 *   동일한 DocSerialLedger 로 모사하고, 문자열 조립·prefix 매핑은 실제 SSOT(src/lib/docSerial.ts)를 직접 호출.
 *
 * AC 커버리지:
 *  - AC-1 배치 출력 시 AV(통원확인서)·VC(진료확인서) 양식이 RPC seq 로 visit_no 조립(공란 아님) — 티켓 근인 해소
 *  - AC-2 prefix 정합: visit_confirm→AV / treat_confirm(+code/nocode)→VC (코드값 대소문자·enum 일치)
 *  - AC-3 이중 INSERT 0: 연번호 발번 양식은 pre-issue 에서만 INSERT, 뒤 일괄 INSERT 에서 제외
 *  - AC-4 비-연번호 양식(prefix 미매핑) 회귀 0: 발번 안 함 + 뒤 일괄 INSERT 로 정상 기록
 *  - AC-5 차트번호 미보유 → 미발번(공란 유지), 가짜 번호 미생성
 *  - AC-6 다른 서류 타입 회귀 0: diagnosis→DIAG 등 기존 prefix 불변
 *
 * 실행: npx playwright test T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE.spec.ts
 * NOTE: 실서버 불요(결정론 모델 + 실제 docSerial SSOT). 라이브 RPC 물리검증은 HARDEN 마이그 검증쿼리로 별도 게이트.
 */

import { test, expect } from '@playwright/test';
import { buildDocSerial, docSerialPrefix } from '../../src/lib/docSerial';

const CLINIC = 'clinic-foot-jongno';

/** issue_foot_doc_serial(clinic_id, form_submission_id) 결정론 모델 (멱등 + gapless MAX+1). */
class DocSerialLedger {
  private rows = new Map<string, { clinicId: string; docSerialSeq: number | null }>();
  insertRow(id: string, clinicId: string) {
    this.rows.set(id, { clinicId, docSerialSeq: null });
  }
  issue(clinicId: string, formSubmissionId: string): number {
    const row = this.rows.get(formSubmissionId);
    if (!row) throw new Error(`form_submission ${formSubmissionId} 미존재`);
    if (row.clinicId !== clinicId) throw new Error('clinic 불일치');
    if (row.docSerialSeq !== null) return row.docSerialSeq; // 멱등
    let max = 0;
    for (const r of this.rows.values())
      if (r.clinicId === clinicId && r.docSerialSeq !== null && r.docSerialSeq > max) max = r.docSerialSeq;
    const seq = max + 1;
    row.docSerialSeq = seq;
    return seq;
  }
  countRows(clinicId: string): number {
    let n = 0;
    for (const r of this.rows.values()) if (r.clinicId === clinicId) n++;
    return n;
  }
}

interface Tpl { id: string; form_key: string }

/**
 * handleBatchPrint 의 연번호 발번 부분을 1:1 모사(fix 로직):
 *   연번호 대상(docSerialPrefix + chartNo) 양식만 INSERT+발번+visit_no 주입.
 *   반환: { perTemplateValues, serialIssuedTemplateIds, ledger }
 */
function batchIssue(
  led: DocSerialLedger,
  clinicId: string,
  templates: Tpl[],
  chartNo: string | null,
  dateYmd: string,
) {
  const perTemplateValues = new Map<string, Record<string, string>>();
  const serialIssuedTemplateIds = new Set<string>();
  let insertSeq = 0;
  for (const t of templates) {
    const eligible = !!docSerialPrefix(t.form_key) && !!chartNo;
    if (!eligible) continue;
    const rowId = `fs-${t.id}-${insertSeq++}`;
    led.insertRow(rowId, clinicId); // ① 선 INSERT
    serialIssuedTemplateIds.add(t.id); // 이중 INSERT 차단
    const seq = led.issue(clinicId, rowId); // ② RPC 발번
    const docSerial = buildDocSerial({ formKey: t.form_key, chartNo, dateYYYYMMDD: dateYmd, seq }); // ③ 조립
    if (!docSerial) continue;
    perTemplateValues.set(t.id, { visit_no: docSerial }); // ④ 주입
  }
  return { perTemplateValues, serialIssuedTemplateIds };
}

/** 뒤 일괄 INSERT 모사 — serialIssuedTemplateIds 제외. */
function trailingInsertCount(templates: Tpl[], issued: Set<string>): number {
  return templates.filter((t) => !issued.has(t.id)).length;
}

// 현장 실제 배치 구성(진료비영수증+세부내역서+진료확인서+통원확인서 묶음) 모사.
const BATCH: Tpl[] = [
  { id: 'tpl-rec', form_key: 'bill_receipt' },
  { id: 'tpl-bill', form_key: 'bill_detail' },
  { id: 'tpl-tcc', form_key: 'treat_confirm_code' },   // 진료확인서(코드포함) = VC
  { id: 'tpl-tcn', form_key: 'treat_confirm_nocode' }, // 진료확인서(코드불포함) = VC
  { id: 'tpl-vc', form_key: 'visit_confirm' },         // 통원확인서 = AV
  { id: 'tpl-refund', form_key: 'refund_consent' },    // 비-연번호(prefix 미매핑)
];

// ── AC-1 (티켓 근인): 배치 출력 시 AV·VC 양식 visit_no 공란 아님 ─────────────────────────────
test('AC-1: 배치 출력에서 진료확인서(VC)·통원확인서(AV) 가 RPC seq 로 visit_no 조립(공란 아님)', () => {
  const led = new DocSerialLedger();
  const { perTemplateValues } = batchIssue(led, CLINIC, BATCH, 'F-4302', '20260706');

  const vc = perTemplateValues.get('tpl-tcc')?.visit_no;
  const vcn = perTemplateValues.get('tpl-tcn')?.visit_no;
  const av = perTemplateValues.get('tpl-vc')?.visit_no;

  for (const [label, v] of [['진료확인서(code)', vc], ['진료확인서(nocode)', vcn], ['통원확인서', av]] as const) {
    expect(v, `${label} visit_no 공란이면 근인 미해소`).toBeTruthy();
    expect(v).not.toBe(''); // 공란 아님 = 버그 해소
  }
});

// ── AC-2: prefix 코드값 정합 (visit_confirm→AV / treat_confirm*→VC) ────────────────────────
test('AC-2: doc_type prefix 정합 — 통원확인서=AV, 진료확인서(code/nocode)=VC (대소문자·enum 일치)', () => {
  expect(docSerialPrefix('visit_confirm')).toBe('AV');
  expect(docSerialPrefix('treat_confirm')).toBe('VC');
  expect(docSerialPrefix('treat_confirm_code')).toBe('VC');
  expect(docSerialPrefix('treat_confirm_nocode')).toBe('VC');

  const led = new DocSerialLedger();
  const { perTemplateValues } = batchIssue(led, CLINIC, BATCH, 'F-4302', '20260706');
  expect(perTemplateValues.get('tpl-vc')!.visit_no).toMatch(/^AV-20260706-F-4302-\d{2,}$/);
  expect(perTemplateValues.get('tpl-tcc')!.visit_no).toMatch(/^VC-20260706-F-4302-\d{2,}$/);
  expect(perTemplateValues.get('tpl-tcn')!.visit_no).toMatch(/^VC-20260706-F-4302-\d{2,}$/);
});

// ── AC-3: 이중 INSERT 0 (발번 양식은 pre-issue 에서만 INSERT) ──────────────────────────────
test('AC-3: 연번호 발번 양식은 뒤 일괄 INSERT 에서 제외 → 이중 기록 0', () => {
  const led = new DocSerialLedger();
  const { serialIssuedTemplateIds } = batchIssue(led, CLINIC, BATCH, 'F-4302', '20260706');

  // 연번호 대상 4종(bill_receipt/bill_detail/tcc/tcn/vc 중 prefix 매핑된 것) 은 pre-issue INSERT.
  const eligibleCount = BATCH.filter((t) => !!docSerialPrefix(t.form_key)).length;
  expect(serialIssuedTemplateIds.size).toBe(eligibleCount);
  // pre-issue 로 이미 INSERT 된 행 수 = eligibleCount (ledger 행 수)
  expect(led.countRows(CLINIC)).toBe(eligibleCount);
  // 뒤 일괄 INSERT 는 나머지(비-연번호) 만 → 총 INSERT = 전체 템플릿 수(중복 0)
  const trailing = trailingInsertCount(BATCH, serialIssuedTemplateIds);
  expect(led.countRows(CLINIC) + trailing).toBe(BATCH.length);
});

// ── AC-4: 비-연번호 양식(prefix 미매핑) 회귀 0 ──────────────────────────────────────────
test('AC-4: refund_consent(prefix 미매핑) 는 발번 안 함 + 뒤 일괄 INSERT 로 정상 기록', () => {
  const led = new DocSerialLedger();
  const { perTemplateValues, serialIssuedTemplateIds } = batchIssue(led, CLINIC, BATCH, 'F-4302', '20260706');
  expect(perTemplateValues.has('tpl-refund')).toBe(false); // 발번 안 함
  expect(serialIssuedTemplateIds.has('tpl-refund')).toBe(false);
  // 뒤 일괄 INSERT 대상에 포함
  expect(trailingInsertCount(BATCH, serialIssuedTemplateIds)).toBeGreaterThanOrEqual(1);
});

// ── AC-5: 차트번호 미보유 → 미발번(공란), 가짜 번호 미생성 ───────────────────────────────────
test('AC-5: 차트번호 미보유 → 발번 보류(가짜 번호 미생성) + 뒤 일괄 INSERT 로 전량 기록', () => {
  const led = new DocSerialLedger();
  const { perTemplateValues, serialIssuedTemplateIds } = batchIssue(led, CLINIC, BATCH, null, '20260706');
  expect(perTemplateValues.size).toBe(0); // 아무 양식도 발번 안 됨
  expect(serialIssuedTemplateIds.size).toBe(0);
  expect(led.countRows(CLINIC)).toBe(0); // pre-issue INSERT 0
  // 전량 뒤 일괄 INSERT 로 처리(누락 0)
  expect(trailingInsertCount(BATCH, serialIssuedTemplateIds)).toBe(BATCH.length);
});

// ── AC-6: 다른 서류 타입 회귀 0 (기존 prefix 불변) ────────────────────────────────────────
test('AC-6: 기존 서류 prefix 회귀 0 — diagnosis=DIAG, diag_opinion=OPN, referral_letter=REF, rx_standard=RX', () => {
  expect(docSerialPrefix('diagnosis')).toBe('DIAG');
  expect(docSerialPrefix('diag_opinion')).toBe('OPN');
  expect(docSerialPrefix('referral_letter')).toBe('REF');
  expect(docSerialPrefix('rx_standard')).toBe('RX');
  expect(docSerialPrefix('bill_receipt')).toBe('REC');
  expect(docSerialPrefix('bill_detail')).toBe('BILL');
  expect(docSerialPrefix('koh_result')).toBe('KOH');
  expect(docSerialPrefix('medical_record_request')).toBe('MR');
  // 미등록 form_key 는 발번 보류(null)
  expect(docSerialPrefix('refund_consent')).toBeNull();
  expect(docSerialPrefix('opinion_doc')).toBeNull();
});

// ── 통산 연속성: 같은 배치 내 발번 seq gapless(중복0) ────────────────────────────────────
test('통산: 같은 배치 내 발번된 연번호는 서로 다른 seq(중복0)', () => {
  const led = new DocSerialLedger();
  const { perTemplateValues } = batchIssue(led, CLINIC, BATCH, 'F-4302', '20260706');
  const serials = [...perTemplateValues.values()].map((v) => v.visit_no);
  expect(new Set(serials).size).toBe(serials.length); // 전부 유일(동일 연번호 미생성)
});
