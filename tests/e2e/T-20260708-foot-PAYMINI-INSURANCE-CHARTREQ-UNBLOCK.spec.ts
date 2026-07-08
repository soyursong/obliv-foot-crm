/**
 * E2E spec — T-20260708-foot-PAYMINI-INSURANCE-CHARTREQ-UNBLOCK
 *
 * 풋센터CRM 결제 미니창(PaymentMiniWindow) — 급여(건강보험) 수납의 '진료기록 필수' +
 * '방문일 일치(당일 방문)' 연동 차단을 완전 해제. 계좌이체 등 비내원일 수납 포함.
 *
 * 결정: 김주연 총괄(U0ATDB587PV), 2026-07-08 KST (ts 1783501423 / 1783501543)
 *   — "수납을 진료기록·방문일과 완전히 분리, 모든 연동 차단 제거".
 *   과거 MEDLAW22-B-GATE 경로1(PaymentMiniWindow) 하드차단을 supersede.
 *
 * AC(티켓 §수용기준):
 *   AC-1 급여 진료 환자 — 진료기록 미작성이어도 [수납] 버튼 활성 + 수납 정상 완료.
 *   AC-2 비내원일(방문일 불일치) — 계좌이체 등, 급여 수납이 차단되지 않고 정상 완료('당일 방문' 체크 제거).
 *   AC-3 차단 기능 모두 제거 + 안내 문구는 비차단 soft 리마인더로 유지(회색 안내, 버튼 항상 활성).
 *   AC-4 비급여/패키지 회귀 없음.
 *   AC-5 수납 완료 후 결제기록·금액·수납방법 정상 저장(차단 제거가 저장 로직에 무영향).
 *
 * 검증 전략(auth/DB 라이브 비의존 — repo 컨벤션):
 *   (A) 소스 정적 가드 — PaymentMiniWindow 에서 차단 게이트 제거 + 비차단 리마인더 존재.
 *   (B) SSOT 단위검증 — getTaxClass(footBilling)로 급여/비급여 분류 회귀 고정(AC-4).
 *   (C) 스코프 가드 — 공유 lib(medicalRecordGate)·경로2/3(Dashboard/PaymentDialog) 무변경.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTaxClass } from '../../src/lib/footBilling';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PMW = () => SRC('components/PaymentMiniWindow.tsx');
const GATE = () => SRC('lib/medicalRecordGate.ts');

// ─────────────────────────────────────────────────────────────────────────────
// (A) 시나리오 1·2 — 급여 수납 차단 완전 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1·AC-2 — 급여 수납 차단 완전 제거', () => {
  test('handleSettle 내 진료기록/방문일 하드차단(blocked-abort) 부재', () => {
    const src = PMW();
    const settleIdx = src.indexOf('const handleSettle');
    const execIdx = src.indexOf('await executeAutoDone');
    expect(settleIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(settleIdx);
    const body = src.slice(settleIdx, execIdx);
    // 수납 직전 게이트 blocked 로 return 하던 차단 로직이 없어야 함.
    expect(body).not.toMatch(/gate\.blocked/);
    expect(body).not.toMatch(/MEDLAW22_BLOCK_MESSAGE/);
    expect(body).not.toMatch(/evaluateMedicalRecordGate\(checkIn\)/);
  });

  test('[수납] 버튼 disabled 에 게이트 차단 조건 없음 — submitting/splitValid 만', () => {
    const src = PMW();
    expect(src).toMatch(/data-testid="btn-settle"/);
    expect(src).toMatch(/disabled=\{submitting \|\| !splitValid\}/);
    // 과거 차단 상태 medGateBlocked 완전 제거.
    expect(src).not.toMatch(/medGateBlocked/);
  });

  test('MEDLAW22_BLOCK_MESSAGE import 제거 — 차단 문구 미사용', () => {
    const src = PMW();
    expect(src).not.toMatch(/MEDLAW22_BLOCK_MESSAGE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (A) AC-3 — 비차단 soft 리마인더 유지(차단 배너 제거)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 비차단 soft 리마인더', () => {
  test('과거 하드차단 배너(⛔) 제거', () => {
    const src = PMW();
    expect(src).not.toMatch(/data-testid="medlaw22-block-banner"/);
    expect(src).not.toMatch(/⛔/);
    // 붉은 차단 스타일 배너 미사용(리마인더는 회색).
    expect(src).not.toMatch(/진료기록 작성 후<\/strong> 수납할 수 있습니다/);
  });

  test('회색 soft 리마인더 존재 — 급여 방문 시 진료기록 후속 작성 안내(비차단)', () => {
    const src = PMW();
    expect(src).toMatch(/data-testid="medrecord-reminder"/);
    // 표시 조건은 isCovered(급여) 기반 — 방문일/차트 존재와 무관(비내원일 오표시 방지).
    expect(src).toMatch(/setMedRecordReminder\(res\.isCovered\)/);
    // 회색 안내 스타일(차단용 red 아님).
    const idx = src.indexOf('data-testid="medrecord-reminder"');
    const around = src.slice(Math.max(0, idx - 400), idx);
    expect(around).toMatch(/text-slate-500/);
    expect(around).not.toMatch(/text-red-700/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) AC-4 — 비급여/패키지 회귀 없음: getTaxClass SSOT 분류 회귀 고정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 — 급여/비급여 분류 SSOT 회귀 고정', () => {
  test('건보 유효등급 + hira_code → 급여 (분류 로직 무변경)', () => {
    const svc = { id: 's1', name: '체외충격파', hira_code: 'NZ001', is_insurance_covered: false, vat_type: 'none' as const };
    expect(getTaxClass(svc, 'general')).toBe('급여');
  });

  test('비급여(자부담) — hira_code 없고 미보장 → 급여 아님', () => {
    const svc = { id: 's2', name: '미용시술', hira_code: null, is_insurance_covered: false, vat_type: 'standard' as const };
    expect(getTaxClass(svc, 'general')).not.toBe('급여');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) 스코프 가드 — 공유 lib·타 경로 무변경(회귀 방지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('스코프 가드 — 공유 lib/타 경로 무변경', () => {
  test('medicalRecordGate lib 은 그대로(Dashboard/PaymentDialog 공유) — evaluate/차단 로직 유지', () => {
    const src = GATE();
    expect(src).toMatch(/export async function evaluateMedicalRecordGate/);
    // 차단 분기(blocked: true)는 lib 에 여전히 존재 — 경로2/3 이 계속 사용.
    expect(src).toMatch(/blocked: true/);
  });

  test('PaymentMiniWindow 은 여전히 evaluateMedicalRecordGate 를 import(리마인더 판정용)', () => {
    expect(PMW()).toMatch(/import \{ evaluateMedicalRecordGate \} from '@\/lib\/medicalRecordGate'/);
  });
});
