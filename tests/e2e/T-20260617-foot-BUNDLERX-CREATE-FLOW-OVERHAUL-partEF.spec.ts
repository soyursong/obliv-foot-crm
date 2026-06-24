/**
 * T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — Part E/F: 빠른처방 → 묶음처방 태그 대체 + 서브탭 retire
 *
 * 현장요청(문지은 대표원장, MSG-20260624-215554-ol3p, 2026-06-24):
 *   "빠른처방은 그냥 삭제해달라니까 묶음처방 아이콘이 빠른처방 대체하게 해줘"
 *
 * Part E [REPLACE]: 진료화면 처방 탭(DoctorTreatmentPanel)의 빠른처방 버튼 바(QuickRxBar) surface 제거 →
 *   묶음처방 태그(BundleRxTagBar)가 그 자리를 차지(coexist 폐지). 태그 클릭=빠른처방 트리거 동작
 *   (onSelectItems 즉시 삽입, TAG-QUICKTRIGGER AC-3) 보존.
 * Part F [RETIRE]: 진료관리(ClinicManagement)의 빠른처방 전용 서브탭(quick_rx) UI 제거.
 *   빠른처방 기능은 묶음처방 태그로 일원화. 구 딥링크(?tab=quick_rx)는 묶음처방(prescriptions)으로 redirect.
 *
 * ⚠ 데이터 보존(§5-5): quick_rx_buttons 테이블·QuickRxButtonsTab 컴포넌트 파일은 물리 보존(UI만 제거).
 *
 * partG/hidename spec 패턴 미러 — 소스 정적 검사(회귀0 presentation 위주).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
// 부정(.not) 검증은 코드만 대상 — 설명 주석의 단어로 인한 거짓 실패 방지.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PANEL = read('src/components/doctor/DoctorTreatmentPanel.tsx');
const PANEL_CODE = stripComments(PANEL);
const CLINIC = read('src/pages/ClinicManagement.tsx');
const CLINIC_CODE = stripComments(CLINIC);

// ── Part E: 처방 탭 QuickRxBar → BundleRxTagBar 대체 ──────────────────────────
test.describe('Part E — 진료 처방 탭 빠른처방 버튼 → 묶음처방 태그 대체', () => {
  test('DoctorTreatmentPanel 에서 QuickRxBar 렌더(JSX)·default import 제거', () => {
    // 빠른처방 버튼 바 JSX surface 제거
    expect(PANEL_CODE).not.toContain('<QuickRxBar');
    // default import(QuickRxBar) 제거, isDoctor named import 만 잔류
    expect(PANEL_CODE).not.toMatch(/import\s+QuickRxBar\s*,/);
    expect(PANEL_CODE).toContain("import { isDoctor } from './QuickRxBar'");
  });

  test('묶음처방 태그(BundleRxTagBar)가 처방 탭에 잔존 — 빠른처방 자리 대체', () => {
    expect(PANEL_CODE).toContain('<BundleRxTagBar');
    expect(PANEL_CODE).toContain("import BundleRxTagBar from './BundleRxTagBar'");
  });

  test('태그 클릭=빠른처방 트리거(onSelectItems 즉시 삽입, dedup) 보존 — AC-3', () => {
    // BundleRxTagBar 가 처방 목록(setRxItems)으로 삽입하는 콜백 배선 보존
    expect(PANEL).toMatch(/<BundleRxTagBar[\s\S]*?onSelectItems=\{\(items\) =>/);
    expect(PANEL).toMatch(/<BundleRxTagBar[\s\S]*?setRxItems\(\(prev\) =>/);
  });

  test('isDoctor 유틸은 계속 사용(doctorMode 판정) — 회귀0', () => {
    expect(PANEL_CODE).toContain('isDoctor(profile?.role ?? \'\')');
  });
});

// ── Part E: BundleRxTagBar 자체가 빠른처방 트리거 동작 유지(SSOT) ─────────────
test.describe('Part E — BundleRxTagBar 트리거 동작 SSOT 보존', () => {
  const BAR = read('src/components/doctor/BundleRxTagBar.tsx');
  test('태그 클릭 → onSelectItems(items) 즉시 삽입(A안, 확인팝업 없음)', () => {
    expect(BAR).toContain('onSelectItems(items)');
    expect(BAR).toContain('function handleTagClick');
  });
  test('role/급여 게이트는 QuickRxBar 와 동일 SSOT 재사용(prescriptionGate/prescribableDrugs)', () => {
    expect(BAR).toContain('checkRxRoleGate');
    expect(BAR).toContain('evaluateRxInsuranceGate');
  });
});

// ── Part F: 빠른처방 전용 서브탭 retire ───────────────────────────────────────
test.describe('Part F — 진료관리 빠른처방 서브탭 제거', () => {
  test('빠른처방 탭 트리거(tab-quick-rx)·패널 제거', () => {
    expect(CLINIC_CODE).not.toContain('data-testid="tab-quick-rx"');
    expect(CLINIC_CODE).not.toContain('value="quick_rx"');
    expect(CLINIC_CODE).not.toContain('<QuickRxButtonsTab');
  });

  test('QuickRxButtonsTab import·Zap 아이콘 import 제거', () => {
    expect(CLINIC_CODE).not.toContain("import QuickRxButtonsTab");
    // Zap 아이콘은 빠른처방 탭 전용 — 잔존 lucide import 에서 제거
    expect(CLINIC_CODE).not.toMatch(/import\s*\{[^}]*\bZap\b[^}]*\}\s*from\s*'lucide-react'/);
  });

  test("accessibleTabs 에서 'quick_rx' 제거", () => {
    expect(CLINIC_CODE).not.toMatch(/'quick_rx'\s*,/);
  });

  test('구 딥링크 ?tab=quick_rx 는 묶음처방(prescriptions)으로 정규화 redirect', () => {
    expect(CLINIC).toMatch(/rawRequestedTab === 'quick_rx'\s*\?\s*'prescriptions'/);
  });
});

// ── 데이터 보존(§5-5): quick_rx_buttons 물리삭제 0건 ──────────────────────────
test.describe('데이터 보존 — quick_rx_buttons UI만 제거, 물리 보존', () => {
  test('QuickRxButtonsTab 컴포넌트 파일은 보존(물리삭제 X)', () => {
    // 컴포넌트가 파일로 존재해야 함(읽기 성공 = 보존). 삭제됐으면 throw.
    expect(() => read('src/components/admin/QuickRxButtonsTab.tsx')).not.toThrow();
  });
});
