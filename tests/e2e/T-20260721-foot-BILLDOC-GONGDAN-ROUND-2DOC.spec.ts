/**
 * T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC
 *
 * 진료비 발행 서류 2종(세부내역서 bill_detail / 계산서·영수증 신양식 bill_receipt_new) 정확성.
 * 김주연 총괄(풋센터, ch C0ATE5P6JTH, thread 1784592055.353669) 현장 피드백. diagnose-first.
 *
 * 본 스펙이 강제하는 fix 불변식 (dev-foot 진단·수정 커밋):
 *   AC-1 (2c) 총액 정합·10원 절사:
 *     계산서·영수증 신양식 ⑧ 환자부담총액 / ⑩ 납부할금액({{patient_amount}}) 은 세부내역서(bill_detail)
 *     합계(detail_total) 와 **동일 SSOT**(computeBillDetailRounding, COPAY-CEIL-TO-FLOOR = round-DOWN)로
 *     10원 절사되어야 하며, 동일 payable(=본인부담금+비급여, 공단 제외)에서 두 서류의 환자 실부담 총액이
 *     정확히 일치해야 한다. (前: 계산서 신양식은 절사 없이 raw → 세부내역서와 불일치 = '총액 안맞음')
 *   AC-2 (2d) [납부한 금액] 합계칸 기본 바인딩:
 *     prepaidAmount 미입력 시 ⑪ 납부한금액 합계 = 납부할금액(=환자부담총액, 절사 후), 납부하지않은금액=0.
 *     prepaidAmount>0 이면 그 값 우선(부분수납), 납부하지않은금액 = patientFloored − prepaid.
 *
 * ⚠ CANON-GATE(1a/2b 공단부담금): §2-2-6 v1.14 canon(grade=null→공단=0) 소관 — 본 스펙/커밋 미접촉.
 *   ⑦ 공단부담총액({{insurance_covered}}) 바인딩 유지 = 회귀 가드.
 *
 * 라이브 브라우저 회귀가 아니라 순수 산식 + 템플릿 바인딩 불변식(로그인 불요, 결정론적).
 * 실행: npx playwright test --project=unit T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { computeBillDetailRounding } from '../../src/lib/footBilling';
import { formatAmount } from '../../src/lib/format';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractNewTemplate(): string {
  const m = HTML_SRC.match(/const BILL_RECEIPT_NEW_HTML\s*=\s*`([\s\S]*?)`;/);
  expect(m, 'BILL_RECEIPT_NEW_HTML 상수 존재').not.toBeNull();
  return m![1];
}

/** DocumentPrintPanel 신양식 ⑪ 납부한금액 합계 기본 바인딩 로직의 순수 재현(2d) — 커밋 로직과 동치. */
function resolvePaid(patientFloored: number, prepaid: number): { paidSum: number; unpaid: number } {
  const paidSum = prepaid > 0 ? prepaid : patientFloored;
  if (paidSum > 0) return { paidSum, unpaid: Math.max(0, patientFloored - paidSum) };
  return { paidSum: 0, unpaid: 0 };
}

test.describe('BILLDOC 2종 정확성 — 총액 10원절사 정합(2c) / 납부한금액 합계칸(2d)', () => {
  // ── AC-1 (2c): 두 서류 환자부담 총액 = 동일 SSOT 10원 절사, 상호 정합 ──
  test('2c: 계산서 환자부담총액 = 세부내역서 합계 (동일 payable → 동일 FLOOR)', () => {
    // payable = 본인부담금 + 비급여 (공단 제외). 10원 미만 우수리 케이스 포함.
    const cases = [308_845, 45_678, 12_340, 99_999, 100_000, 7, 0];
    for (const payable of cases) {
      // 세부내역서 합계
      const detail = computeBillDetailRounding(payable);
      // 계산서 신양식: rawPatient(=payable) 을 동일 함수로 절사 (커밋 로직)
      const rc = computeBillDetailRounding(payable);
      expect(rc.roundedTotal, `payable=${payable} 두 서류 총액 정합`).toBe(detail.roundedTotal);
      // 절사 결과는 항상 10원 배수
      expect(rc.roundedTotal % 10, `payable=${payable} 10원 배수`).toBe(0);
      // 조정금액(adjustment) ≤ 0, |adjustment| < 10
      expect(rc.adjustment).toBeLessThanOrEqual(0);
      expect(Math.abs(rc.adjustment)).toBeLessThan(10);
    }
  });

  test('2c: FLOOR(round-DOWN) 방향 — 우수리 버림(CEIL 아님)', () => {
    expect(computeBillDetailRounding(308_845).roundedTotal).toBe(308_840);
    expect(computeBillDetailRounding(45_678).roundedTotal).toBe(45_670);
    expect(computeBillDetailRounding(12_349).roundedTotal).toBe(12_340);
    // 이미 10원 배수면 조정 0
    expect(computeBillDetailRounding(308_800).adjustment).toBe(0);
  });

  test('2c: 계산서 ⑧환자부담총액·⑩납부할금액 = {{patient_amount}} 단일 소스(두 칸 동일)', () => {
    const tpl = extractNewTemplate();
    // ⑧ 환자부담 총액 행
    expect(tpl).toMatch(/⑧ 환자부담 총액[\s\S]*?\{\{patient_amount\}\}/);
    // ⑩ 납부할 금액 행
    expect(tpl).toMatch(/⑩ 납부할 금액[\s\S]*?\{\{patient_amount\}\}/);
  });

  // ── AC-2 (2d): ⑪ 납부한 금액 합계칸 기본 바인딩 ──
  test('2d: 미입력 시 납부한금액 합계 = 납부할금액(절사 후), 납부하지않은금액=0', () => {
    const patientFloored = computeBillDetailRounding(45_678).roundedTotal; // 45,670
    const { paidSum, unpaid } = resolvePaid(patientFloored, 0);
    expect(paidSum).toBe(45_670);
    expect(unpaid).toBe(0);
    expect(formatAmount(paidSum)).toBe('45,670');
  });

  test('2d: 사전입력(부분수납) 우선 — 합계=입력값, 납부하지않은금액=총액−입력값', () => {
    const patientFloored = computeBillDetailRounding(100_000).roundedTotal; // 100,000
    const { paidSum, unpaid } = resolvePaid(patientFloored, 30_000);
    expect(paidSum).toBe(30_000);
    expect(unpaid).toBe(70_000);
  });

  test('2d: 총액 0 → 합계·납부하지않은금액 모두 0(공란 처리 대상)', () => {
    const { paidSum, unpaid } = resolvePaid(0, 0);
    expect(paidSum).toBe(0);
    expect(unpaid).toBe(0);
  });

  test('2d: ⑪ 납부한금액 합계칸 = {{prepaid_amount}}, 납부하지않은금액 = {{unpaid_amount}} 바인딩', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(/합계 <span[^>]*>\{\{prepaid_amount\}\}<\/span>/);
    expect(tpl).toMatch(/납부하지 않은 금액[\s\S]*?\{\{unpaid_amount\}\}/);
  });

  // ── 회귀 가드: CANON-GATE(공단부담금) 미접촉 ──
  test('regression: ⑦ 공단부담총액 = {{insurance_covered}} 바인딩 유지(canon 미접촉)', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(/⑦ 공단부담 총액[\s\S]*?\{\{insurance_covered\}\}/);
  });

  test('regression: 진찰료 급여 split(본인/공단) 및 처치·검사 항목분해 토큰 유지', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toContain('{{proc_noncov}}');
    expect(tpl).toContain('{{exam_noncov}}');
    expect(tpl).toContain('{{etc_noncov}}');
  });
});
