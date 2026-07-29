/**
 * E2E spec — T-20260728-foot-INSUR-POPUP-REMOVE
 *
 * 풋센터CRM 급여(건강보험) 진료 완료 전환의 '진료기록(서명) 미작성' 하드차단 팝업 제거.
 * 급여 진료 + 진료기록 미작성 상태에서도 [수납대기]→[완료] 전환이 차단 팝업 없이 정상 완료된다.
 *
 * 결정: 문지은 대표원장 "B안" 직접 컨펌(2026-07-28, 슬랙 스레드 본인 결정).
 *   과거 MEDLAW22-B-GATE 하드차단 3지점(Dashboard 드래그/우클릭 완료, PaymentDialog 수납 완료)을 제거.
 *   PaymentMiniWindow 경로는 이미 T-20260708 에서 비차단 soft ℹ️ 로 전환됨 — 그 패턴에 3지점 정합.
 *
 * AC(티켓 §수용기준):
 *   AC-1 급여 진료 + 진료기록 미작성 → [수납대기]→[완료] 전환 시 차단 팝업 미노출·정상 완료.
 *        하드차단 3지점 분기 제거/비차단화:
 *          · Dashboard.tsx 드래그 완료(handleDragEnd)
 *          · Dashboard.tsx 우클릭 완료(handleContextStatusChange)
 *          · PaymentDialog.tsx 수납 완료(handleSubmit)
 *   AC-2 inline ℹ️ 진료기록 작성 의무 안내(급여청구 리마인드)는 존치 — 완료 전환 차단만 해제.
 *   AC-3 급여 플래그·본인부담/공단부담 산식·수납잔액 계산 read-only 미접촉(SSOT 회귀 고정).
 *   AC-4 비급여/자보 등 다른 진료유형 완료 전환 기존 동작 회귀 없음.
 *
 * 검증 전략(auth/DB 라이브 비의존 — repo 컨벤션):
 *   (A) 소스 정적 가드 — 3지점에서 하드차단(gate.blocked→toast.error+return) 부재.
 *   (B) 존치 가드 — PaymentMiniWindow soft ℹ️ 리마인더 유지(AC-2).
 *   (C) SSOT 단위검증 — getTaxClass(footBilling) 급여/비급여 분류 회귀 고정(AC-3/AC-4).
 *   (D) 스코프 가드 — medicalRecordGate lib 함수 존치(soft 리마인더 판정용 재사용).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTaxClass } from '../../src/lib/footBilling';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DASH = () => SRC('pages/Dashboard.tsx');
const PAYDLG = () => SRC('components/PaymentDialog.tsx');
const PMW = () => SRC('components/PaymentMiniWindow.tsx');
const GATE = () => SRC('lib/medicalRecordGate.ts');

/** 주석을 제거해 '실제 코드'만 남긴다(제거 근거 주석에 함수명이 남아 오탐하는 것 방지). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 블록 주석
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 라인 주석(url:// 오제거 방지 위해 앞문자 보존)
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) AC-1 — 하드차단 3지점 제거: 완료 전환 차단 팝업 부재
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 급여 완료 전환 하드차단 3지점 제거', () => {
  test('Dashboard(드래그·우클릭 완료) — evaluateMedicalRecordGate 하드차단 호출 부재', () => {
    const code = stripComments(DASH());
    // 게이트 평가 호출 자체가 완료 경로에서 제거됨(드래그/우클릭 공통).
    expect(code).not.toMatch(/evaluateMedicalRecordGate\s*\(/);
    // 차단 소비(gate.blocked → return)도 부재.
    expect(code).not.toMatch(/gate\.blocked/);
    // 완료 차단 안내 toast 문구 부재.
    expect(code).not.toMatch(/진료기록 작성 후 완료할 수 있습니다/);
  });

  test('Dashboard — evaluateMedicalRecordGate import 제거(미사용)', () => {
    const code = stripComments(DASH());
    expect(code).not.toMatch(/import\s*\{[^}]*evaluateMedicalRecordGate[^}]*\}\s*from\s*['"]@\/lib\/medicalRecordGate['"]/);
  });

  test('PaymentDialog(수납 완료 handleSubmit) — 하드차단(blocked-abort) 부재', () => {
    const code = stripComments(PAYDLG());
    const submitIdx = code.indexOf('const handleSubmit');
    expect(submitIdx).toBeGreaterThan(-1);
    const body = code.slice(submitIdx);
    // 수납 완료 직전 게이트 blocked 로 setSubmitting(false)+return 하던 차단 로직 부재.
    expect(body).not.toMatch(/evaluateMedicalRecordGate\s*\(/);
    expect(body).not.toMatch(/gate\.blocked/);
    expect(body).not.toMatch(/MEDLAW22_BLOCK_MESSAGE/);
  });

  test('PaymentDialog — 차단 게이트 import 제거(미사용)', () => {
    const code = stripComments(PAYDLG());
    expect(code).not.toMatch(/import\s*\{[^}]*evaluateMedicalRecordGate[^}]*\}\s*from\s*['"]@\/lib\/medicalRecordGate['"]/);
    expect(code).not.toMatch(/MEDLAW22_BLOCK_MESSAGE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) AC-2 — inline ℹ️ 진료기록 작성 안내 존치(비차단 soft 리마인더)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — inline ℹ️ 안내 존치', () => {
  test('PaymentMiniWindow soft 리마인더(ℹ️) 유지 — 차단 아님', () => {
    const src = PMW();
    // inline ℹ️ 리마인더 마크업 존치.
    expect(src).toMatch(/data-testid="medrecord-reminder"/);
    expect(src).toMatch(/진료기록\(서명 포함\)<\/strong> 작성이 필요합니다/);
    // 표시 조건 = isCovered(급여) 기반(비차단, 버튼 항상 활성).
    expect(src).toMatch(/setMedRecordReminder\(res\.isCovered\)/);
  });

  test('PaymentMiniWindow — 수납 버튼은 게이트 차단 조건 없이 활성 유지', () => {
    const src = PMW();
    expect(src).toMatch(/data-testid="btn-settle"/);
    // 차단 상태값(medGateBlocked) 부재 — soft 리마인더는 버튼을 막지 않음.
    expect(src).not.toMatch(/medGateBlocked/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) AC-3/AC-4 — 급여/비급여 분류 SSOT 회귀 고정(산식 read-only 미접촉)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3·AC-4 — 급여/비급여 분류 SSOT 회귀 고정', () => {
  test('건보 유효등급 + hira_code → 급여 (분류 로직 무변경)', () => {
    const svc = { id: 's1', name: '체외충격파', hira_code: 'NZ001', is_insurance_covered: false, vat_type: 'none' as const };
    expect(getTaxClass(svc, 'general')).toBe('급여');
  });

  test('비급여(자부담) — hira_code 없고 미보장 → 급여 아님(AC-4 회귀 없음)', () => {
    const svc = { id: 's2', name: '미용시술', hira_code: null, is_insurance_covered: false, vat_type: 'standard' as const };
    expect(getTaxClass(svc, 'general')).not.toBe('급여');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (D) 스코프 가드 — medicalRecordGate lib 함수 존치(soft 리마인더 판정 재사용)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('스코프 가드 — 공유 lib 함수 존치', () => {
  test('evaluateMedicalRecordGate 함수·isCovered 판정 존치(PaymentMiniWindow 재사용)', () => {
    const src = GATE();
    expect(src).toMatch(/export async function evaluateMedicalRecordGate/);
    // isCovered(급여 여부) 판정은 soft 리마인더용으로 계속 사용됨.
    expect(src).toMatch(/isCovered/);
    // PaymentMiniWindow 는 여전히 import 하여 리마인더 판정에 사용.
    expect(PMW()).toMatch(/import \{ evaluateMedicalRecordGate \} from '@\/lib\/medicalRecordGate'/);
  });

  test('lib 헤더에 하드차단 해제 근거(문원장 B안, 2026-07-28) 기록', () => {
    const src = GATE();
    expect(src).toMatch(/INSUR-POPUP-REMOVE/);
    expect(src).toMatch(/2026-07-28/);
  });
});
