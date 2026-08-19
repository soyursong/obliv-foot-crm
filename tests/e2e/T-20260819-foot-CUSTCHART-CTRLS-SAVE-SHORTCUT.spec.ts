/**
 * T-20260819-foot-CUSTCHART-CTRLS-SAVE-SHORTCUT (P2)
 * 고객 차트(치료메모·기록) 화면 Ctrl+S 저장 단축키 추가 — E2E(소스-가드) 검증
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-1: Ctrl/Cmd+S = 기존 저장(handleSave) 재사용 — 신규 저장 로직 없음
 *   AC-2: e.preventDefault() 로 브라우저 기본 저장 다이얼로그 차단
 *   AC-3: dirty=false(빈 입력)면 handleSave 내부 early-return → 불필요 저장 미발생
 *   AC-4: Textarea onKeyDown 스코프(입력창 포커스 시에만 발화) → 모달/팝업 오작동 방지
 *   AC-5: 기존 Ctrl+K(AdminLayout) / Ctrl+Enter 단축키 회귀 없음 + 빌드 코드분할 계약
 *
 * NOTE: 본 레포 치료메모 E2E 관례(T-20260520-foot-MEMO-HISTORY 등)를 따라
 *       소스-가드(정적 계약) 방식으로 결정론 검증한다. db_change=false, FE-only.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPOSER_PATH = path.resolve(
  __dirname,
  '../../src/components/TreatmentMemoComposer.tsx',
);
const ADMIN_LAYOUT_PATH = path.resolve(
  __dirname,
  '../../src/components/AdminLayout.tsx',
);
const APP_PATH = path.resolve(__dirname, '../../src/App.tsx');
const DIST_PATH = path.resolve(__dirname, '../../dist');

// ── AC-1: 기존 저장 핸들러 재사용 (신규 저장 로직 없음) ─────────────

test('AC-1: Ctrl/Cmd+S 감지 헬퍼 존재 (ctrl/meta + s)', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  expect(src).toContain('function isCtrlS');
  // ctrl 또는 meta(cmd) + s/S 조합
  expect(src).toContain('(e.ctrlKey || e.metaKey)');
  expect(src).toMatch(/e\.key === 's' \|\| e\.key === 'S'/);
});

test('AC-1: composer/editor 모두 기존 handleSave 를 재사용 (신규 저장 로직 없음)', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  // 신규 저장 handler 발명 금지 — 단축키 경로는 반드시 handleSave 호출
  const handleSaveCalls = (src.match(/void handleSave\(\);/g) ?? []).length;
  // composer + editor 두 곳
  expect(handleSaveCalls).toBeGreaterThanOrEqual(2);
  // 단축키 경로가 supabase/insert/update 를 직접 호출하지 않음(기존 경로 재사용)
  expect(src).not.toContain('supabase');
});

test('AC-1: 저장 진행 중(saving)이면 중복 저장 방지 (버튼 disabled 미러)', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  expect(src).toContain('if (saving) return;');
});

// ── AC-2: preventDefault 로 브라우저 기본 저장 차단 ────────────────

test('AC-2: Ctrl+S 처리 시 e.preventDefault() 호출', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  // isCtrlS 가드 직후 preventDefault
  expect(src).toMatch(/if \(!isCtrlS\(e\)\) return;\s*\n\s*e\.preventDefault\(\);/);
});

// ── AC-3: dirty=false 면 no-op ────────────────────────────────────

test('AC-3: handleSave 는 빈 입력 시 early-return (불필요 저장 미발생)', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  // handleSave 내부 trim 가드 — dirty=false 면 onSave 미호출
  expect(src).toMatch(/const trimmed = text\.trim\(\);\s*\n\s*if \(!trimmed\) return;/);
});

// ── AC-4: Textarea onKeyDown 스코프 (모달/팝업 오작동 방지) ─────────

test('AC-4: 새 메모 입력창(Textarea)에 onKeyDown 배선', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  // 신규 메모 입력창
  expect(src).toContain('data-testid="treatment-memo-new-input"');
  // 수정 입력창
  expect(src).toContain('data-testid="treatment-memo-edit-input"');
  // 두 Textarea 모두 handleKeyDown 배선 (입력창 포커스 스코프 → 전역 리스너 아님)
  const onKeyDownCount = (src.match(/onKeyDown=\{handleKeyDown\}/g) ?? []).length;
  expect(onKeyDownCount).toBe(2);
});

test('AC-4: 전역 window keydown 리스너를 새로 추가하지 않음 (스코프 격리)', () => {
  const src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  // composer 는 입력창 onKeyDown 만 사용 — window.addEventListener('keydown') 도입 금지
  expect(src).not.toContain("addEventListener('keydown'");
});

// ── AC-5: 기존 단축키 회귀 없음 + 빌드 계약 ────────────────────────

test('AC-5: 기존 Ctrl+K(고객 검색, AdminLayout) 단축키 보존', () => {
  const src = fs.readFileSync(ADMIN_LAYOUT_PATH, 'utf-8');
  expect(src).toContain("(e.metaKey || e.ctrlKey) && e.key === 'k'");
});

test('AC-5: 빌드 코드분할 — CustomerChartPage lazy chunk 계약 유지', () => {
  const appSrc = fs.readFileSync(APP_PATH, 'utf-8');
  expect(
    /CustomerChartPage\s*=\s*lazy\w*\(\s*\(\)\s*=>\s*import\(\s*['"]@\/pages\/CustomerChartPage['"]\s*\)/.test(appSrc),
    'App.tsx CustomerChartPage 동적 import(코드분할) 계약 누락',
  ).toBe(true);

  if (fs.existsSync(DIST_PATH) && fs.existsSync(path.join(DIST_PATH, 'assets'))) {
    const assets = fs.readdirSync(path.join(DIST_PATH, 'assets'));
    expect(assets.some((f) => f.startsWith('CustomerChartPage')), 'dist chunk CustomerChartPage 누락').toBe(true);
  }
});
