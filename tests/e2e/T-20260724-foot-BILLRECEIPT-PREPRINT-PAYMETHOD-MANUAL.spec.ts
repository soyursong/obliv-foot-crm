/**
 * T-20260724-foot-BILLRECEIPT-PREPRINT-PAYMETHOD-MANUAL
 *
 * 진료비 계산서·영수증 금액산정(빨간박스)·현금영수증(보라박스) 재정의 — B안 확정(캐논 supersede).
 * base = origin/main. 표시층/토큰 한정 + 수기입력값 form_submissions.field_data(JSONB) persist(무DDL, db_change 실질 false).
 *
 *   ★policy_superseded: T-20260723-foot-BILLRECEIPT-PAIDBOX-NONCOV-MISROUTED(⑪=payments 원장 net만·실수납前 기입 금지)을
 *   print-time 수기체크 플로우에 한해 대체(총괄 '진행ㄱㄱ'+캐논owner 팀장 endorsement+책임 현장확정, MSG-...-2fb5).
 *
 *   확정 스펙(이은상 팀장 세부):
 *     ⑨ 이미 납부한 금액 = 환자부담총액(완납 표기)
 *     ⑩ 납부할 금액 = 공란(미사용)
 *     ⑪ 납부한 금액 = 선출력 시 결제수단(카드/현금/현금영수증) 수기체크 → 선택수단칸에 환자부담총액.
 *        ⑪은 ⑨의 결제수단 breakdown(비-가산 — ⑨와 더하지 말 것: ⑧=⑨+미납). double-count 해소.
 *     현금/현금영수증 선택 시 → 신분확인번호·승인번호 하단 보라박스(현금영수증( )·승인번호) 반영·저장.
 *     미납(납부하지 않은 금액) = 0.
 *
 * 라이브 앱 회귀 아님 — 순수 토큰 산식(결정론적) + 소스 가드.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { applyBillReceiptPreprintPaymethodTokens } from '../../src/lib/footBilling';

const ROOT = process.cwd();
const FB_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/footBilling.ts'), 'utf8');
const DPP_SRC = fs.readFileSync(path.join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const TMPL_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

const PATIENT = 248700; // 환자부담총액 예시(10원 배수)

test.describe('BILLRECEIPT-PREPRINT-PAYMETHOD-MANUAL — 선출력 수기체크 결제수단 토큰', () => {
  // ═══════════ ⑨/⑩/미납 canon (결제수단 무관 공통) ═══════════
  test('canon: ⑨=환자부담총액(완납), ⑩ 공란, 미납=0 (수단 미선택)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, PATIENT, {});
    expect(v.already_paid).toBe('248,700'); // ⑨ 완납
    expect(v.due_amount).toBe('');          // ⑩ 미사용
    expect(v.unpaid_amount).toBe('0');      // 미납 0
    // 수단 미선택 → ⑪ 3칸 + 합계 공란(현장 수기 체크)
    expect(v.card_amount).toBe('');
    expect(v.cash_amount).toBe('');
    expect(v.cashreceipt_amount).toBe('');
    expect(v.paid_total).toBe('');
    // 보라박스 공란
    expect(v.cashreceipt_mark).toBe('');
    expect(v.cashreceipt_id_number).toBe('');
    expect(v.cashreceipt_approval_no).toBe('');
  });

  // ═══════════ ⑪ 결제수단별 breakdown (비-가산) ═══════════
  test('카드 선택 → ⑪ 카드칸=환자부담총액, 나머지 공란, 보라박스 미노출', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, PATIENT, { method: 'card' });
    expect(v.card_amount).toBe('248,700');
    expect(v.cash_amount).toBe('');
    expect(v.cashreceipt_amount).toBe('');
    expect(v.paid_total).toBe('248,700');
    expect(v.already_paid).toBe('248,700'); // ⑨ 그대로(⑪은 breakdown, 비-가산)
    expect(v.unpaid_amount).toBe('0');
    // 카드는 승인번호칸 미노출/미저장
    expect(v.cashreceipt_mark).toBe('');
    expect(v.cashreceipt_id_number).toBe('');
    expect(v.cashreceipt_approval_no).toBe('');
  });

  test('현금영수증 선택 → ⑪ 현금영수증칸=총액, 현금영수증( )=V, 승인번호 반영', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, PATIENT, {
      method: 'cashreceipt',
      cashReceiptIdNo: '010-1234-5678',
      cashReceiptApprovalNo: 'A0099887766',
    });
    expect(v.cashreceipt_amount).toBe('248,700');
    expect(v.card_amount).toBe('');
    expect(v.cash_amount).toBe('');
    expect(v.paid_total).toBe('248,700');
    expect(v.cashreceipt_mark).toBe('V');
    expect(v.cashreceipt_id_number).toBe('010-1234-5678');
    expect(v.cashreceipt_approval_no).toBe('A0099887766');
  });

  test('현금 선택 → ⑪ 현금칸=총액, 승인번호칸 노출(반영)·현금영수증( ) 미체크', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, PATIENT, {
      method: 'cash',
      cashReceiptIdNo: '880101-1',
      cashReceiptApprovalNo: 'B123',
    });
    expect(v.cash_amount).toBe('248,700');
    expect(v.cashreceipt_amount).toBe('');
    expect(v.paid_total).toBe('248,700');
    // 현금은 현금영수증( ) 체크마크 없음
    expect(v.cashreceipt_mark).toBe('');
    // 단 현금/현금영수증 공통으로 번호는 반영
    expect(v.cashreceipt_id_number).toBe('880101-1');
    expect(v.cashreceipt_approval_no).toBe('B123');
  });

  test('카드 선택 시 승인번호 입력값이 들어와도 표기·저장에서 제거(gating)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, PATIENT, {
      method: 'card',
      cashReceiptIdNo: 'STALE',
      cashReceiptApprovalNo: 'STALE',
    });
    expect(v.cashreceipt_id_number).toBe('');
    expect(v.cashreceipt_approval_no).toBe('');
  });

  // ═══════════ 절사·엣지 ═══════════
  test('10원 우수리 → ⑨/⑪ 모두 FLOOR 정합', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, 248705, { method: 'card' });
    expect(v.already_paid).toBe('248,700');
    expect(v.card_amount).toBe('248,700');
  });

  test('환자부담 0 → 전 칸 공란(미납도 공란)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPreprintPaymethodTokens(v, 0, { method: 'cashreceipt' });
    expect(v.already_paid).toBe('');
    expect(v.cashreceipt_amount).toBe('');
    expect(v.paid_total).toBe('');
    expect(v.unpaid_amount).toBe('');
  });

  // ═══════════ 소스 가드 (배선·템플릿·persist 경로) ═══════════
  test('가드: 신양식 단건·일괄 두 경로 모두 신 헬퍼 호출(payments-원장 헬퍼 미호출)', () => {
    const calls = DPP_SRC.match(/applyBillReceiptPreprintPaymethodTokens\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2); // 단건 memo + 일괄 valuesFor
    // 종전 payments-원장 driven 헬퍼는 실제 호출 제거(주석 언급만 허용)
    expect(DPP_SRC).not.toMatch(/applyBillReceiptPaidBoxTokens\(base/);
    expect(DPP_SRC).not.toMatch(/applyBillReceiptPaidBoxTokens\(v,/);
  });

  test('가드: 발급폼에 결제수단 3칩 + 현금/현금영수증 승인번호 입력칸 노출', () => {
    // 3칩 testid 는 템플릿리터럴(docprint-paymethod-${key}) — prefix + 3 key 존재 확인.
    expect(DPP_SRC).toContain('docprint-paymethod-');
    expect(DPP_SRC).toMatch(/key:\s*'card'/);
    expect(DPP_SRC).toMatch(/key:\s*'cash'/);
    expect(DPP_SRC).toMatch(/key:\s*'cashreceipt'/);
    expect(DPP_SRC).toContain('docprint-cashreceipt-idno');
    expect(DPP_SRC).toContain('docprint-cashreceipt-approvalno');
    // 수기입력값은 manualValues → field_data(JSONB) persist(무DDL)
    expect(DPP_SRC).toContain("updateField('paymethod_preprint'");
    expect(DPP_SRC).toContain("updateField('cashreceipt_id_number'");
    expect(DPP_SRC).toContain("updateField('cashreceipt_approval_no'");
  });

  test('가드: bill_receipt_new 템플릿 보라박스에 현금영수증 mark·신분확인번호·승인번호 토큰 바인딩', () => {
    expect(TMPL_SRC).toContain('{{cashreceipt_mark}}');
    expect(TMPL_SRC).toContain('{{cashreceipt_id_number}}');
    expect(TMPL_SRC).toContain('{{cashreceipt_approval_no}}');
  });

  test('가드: 신 헬퍼가 footBilling.ts export', () => {
    expect(FB_SRC).toContain('export function applyBillReceiptPreprintPaymethodTokens');
  });
});
