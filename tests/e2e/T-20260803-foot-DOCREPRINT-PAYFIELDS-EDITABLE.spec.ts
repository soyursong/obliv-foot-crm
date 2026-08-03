/**
 * E2E spec — T-20260803-foot-DOCREPRINT-PAYFIELDS-EDITABLE (P0, 총괄 김주연 직접 지시)
 *
 * 요구: 계산서·영수증(bill_receipt_new) 발행/재발급 모달의 결제금액 4필드
 *   (본인부담금 copayment · 공단부담금 insurance_covered · 비급여 non_covered · 진료비총액 total_amount)
 *   + 환자부담총액(patient_amount)을 (자동)+사실상 readOnly → 편집 가능(enabled)으로 전환.
 *   자동반영은 유지(모달 오픈 시 라이브 산출값 채움), 사용자가 수정하면 그 값이 서류 출력에 반영,
 *   미수정 시 자동값 그대로.
 *
 * 근본원인(진단 확정): 필드 input 자체는 renderEditableField 로 렌더되어 편집 가능했으나,
 *   allValues memo 가 bill_receipt_new 에 대해 매 렌더 라이브 자동값으로 force 재계산
 *   (computedTotal → total_amount / applyBillReceiptNewLiveTotals → copayment·insurance_covered·
 *    non_covered·total_amount / floorBillReceiptNewPatientTotal → patient_amount)하여
 *   사용자 입력을 즉시 되돌림 → 현장 체감 readOnly.
 *
 * 수정(no-DDL, 원장 무접촉): amountOverrides 상태 신설 → 사용자가 명시 입력한 결제금액 키만 기록,
 *   allValues 최종단(editOverrides 병합 직후)에 병합해 라이브 자동값보다 우선 적용.
 *   자동 산출 로직 자체 무변경(미수정 필드는 종전 라이브 자동값 = 회귀 0).
 *   금액 필드는 AmountInput(천단위 쉼표)로 렌더, 지우면(빈값) override 해제 → 자동값 복귀.
 *   payments/service_charges 등 결제·수납 원장 write 없음 — field_data(JSONB) 표시 persist 전용.
 *
 * AC:
 *   (1) 결제금액 5필드(4 + 환자부담총액)가 편집 가능한 input 으로 렌더(readOnly/disabled 아님).
 *   (2) 모달 오픈 시 자동 산출값 채움(자동반영 로직 무변경).
 *   (3) 사용자 수정값이 출력 바인딩(allValues)에 최우선 반영, 미수정은 자동값.
 *   (4) 원장(payments/service_charges) write 신설 없음(표시 전용).
 *
 * ⚠ 발행 모달 DOM 은 실 seed(체크인·서비스차지) 의존이 커 graceful skip(레포 관례).
 *   회귀 앵커는 소스 계약 정적 단언으로 seed-무관 결정론 보장.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

test.describe('T-20260803 DOCREPRINT-PAYFIELDS-EDITABLE — 결제금액 필드 편집 가능화', () => {
  const SRC = 'src/components/DocumentPrintPanel.tsx';

  test('C1: 결제금액 override 키 계약 — 4필드 + 환자부담총액', () => {
    const src = read(SRC);
    expect(src).toMatch(/MANUAL_AMOUNT_OVERRIDE_KEYS\s*=\s*\[/);
    // 4 core + patient_amount 모두 포함.
    for (const k of ['copayment', 'insurance_covered', 'non_covered', 'total_amount', 'patient_amount']) {
      expect(src).toContain(`'${k}'`);
    }
  });

  test('C2: amountOverrides 상태 신설 + updateField 기록 배선', () => {
    const src = read(SRC);
    // 상태 선언(빈 객체 시작 = 오픈 시 자동값 그대로 표시, 자동반영 유지).
    expect(src).toMatch(/const \[amountOverrides, setAmountOverrides\] = useState<Record<string, string>>\(\{\}\)/);
    // updateField 가 결제금액 키를 amountOverrides 에 기록.
    expect(src).toMatch(/MANUAL_AMOUNT_OVERRIDE_KEYS as readonly string\[\]\)\.includes\(key\)/);
    expect(src).toMatch(/setAmountOverrides\(/);
    // 빈값이면 override 해제(자동값 복귀).
    const upIdx = src.indexOf('setAmountOverrides((prev)');
    expect(upIdx).toBeGreaterThan(0);
    const upBlock = src.slice(upIdx, upIdx + 220);
    expect(upBlock).toMatch(/if \(value === ''\) delete next\[key\]/);
  });

  test('C3: allValues 최종단 override 병합 + memo dep', () => {
    const src = read(SRC);
    // editOverrides 병합 loop 이후에 결제금액 override loop 존재(최우선 = 라이브 자동값 override).
    const editIdx = src.indexOf('for (const [k, v] of Object.entries(editOverrides))');
    const amtIdx = src.indexOf('for (const k of MANUAL_AMOUNT_OVERRIDE_KEYS)');
    expect(editIdx).toBeGreaterThan(0);
    expect(amtIdx).toBeGreaterThan(editIdx); // 결제금액 override 는 editOverrides 뒤 = 최종단.
    // override loop 은 값 있는 키만 base 에 대입(미수정 무파괴).
    const amtBlock = src.slice(amtIdx, amtIdx + 160);
    expect(amtBlock).toMatch(/const v = amountOverrides\[k\]/);
    expect(amtBlock).toMatch(/if \(v != null && v !== ''\) base\[k\] = v/);
    // memo dependency 에 amountOverrides 포함(재렌더 반영).
    const memoDeps = src.slice(src.indexOf('return base;'), src.indexOf('return base;') + 800);
    expect(memoDeps).toContain('amountOverrides');
  });

  test('C4: ⑧ 환자부담총액 override 시 ⑨/⑩ 납부박스 파생 정합', () => {
    const src = read(SRC);
    // override 있으면 자동 절사값(autoPatientFloored) 대신 override 사용 → paymethod 토큰도 동일값.
    expect(src).toMatch(/const autoPatientFloored = floorBillReceiptNewPatientTotal/);
    expect(src).toMatch(/const patientOverrideRaw = amountOverrides\.patient_amount/);
    expect(src).toMatch(/const patientFloored = hasPatientOverride \? parseAmountStr\(patientOverrideRaw\) : autoPatientFloored/);
    // 납부박스 토큰이 override 반영된 patientFloored 를 소비.
    const payIdx = src.indexOf('applyBillReceiptPreprintPaymethodTokens(base, patientFloored');
    expect(payIdx).toBeGreaterThan(0);
  });

  test('C5: 결제금액 필드 = 편집 가능한 AmountInput(readOnly/disabled 아님)', () => {
    const src = read(SRC);
    // renderEditableField 의 amount 분기 = AmountInput + updateField 배선.
    expect(src).toMatch(/f\.type === 'amount' \?/);
    const amtRenderIdx = src.indexOf("f.type === 'amount' ?");
    const amtRender = src.slice(amtRenderIdx, amtRenderIdx + 500);
    expect(amtRender).toMatch(/<AmountInput/);
    expect(amtRender).toMatch(/onChange=\{\(raw\) => updateField\(f\.key, formatAmountDisplay\(raw\)\)\}/);
    // readOnly/disabled 로 잠그지 않음(편집 가능 보장).
    expect(amtRender).not.toMatch(/readOnly/);
    expect(amtRender).not.toMatch(/disabled/);
    // 천단위 쉼표 포맷 헬퍼 import.
    expect(src).toMatch(/import \{ AmountInput, formatAmountDisplay \}/);
  });

  test('C6: 자동 산출 로직 무변경 — applyBillReceiptNewLiveTotals 보존(회귀 가드)', () => {
    const src = read(SRC);
    // 라이브 자동 세팅은 그대로 유지(자동반영 유지). override 는 그 위에 얹는 최종단 레이어.
    expect(src).toMatch(/applyBillReceiptNewLiveTotals\(base, \{/);
    // computedTotal → total_amount 자동 바인딩도 보존.
    expect(src).toMatch(/base\.total_amount = formatAmount\(computedTotal\)/);
  });

  test('C7: 결제·수납 원장 write 신설 없음 — 표시(field_data) 전용', () => {
    const src = read(SRC);
    // override 로직 주변(결제금액 처리)에서 payments/service_charges 로 write(insert/update)를 추가하지 않음.
    // 스코프: MANUAL_AMOUNT_OVERRIDE_KEYS 주석/로직 인근에 원장 write 금지.
    const anchorIdx = src.indexOf('for (const k of MANUAL_AMOUNT_OVERRIDE_KEYS)');
    const region = src.slice(Math.max(0, anchorIdx - 400), anchorIdx + 400);
    expect(region).not.toMatch(/\.from\(['"]payments['"]\)/);
    expect(region).not.toMatch(/\.from\(['"]service_charges['"]\)/);
  });
});
