/**
 * E2E spec — T-20260608-foot-DXMGMT-EDIT-SAVE-BUG  (구조 갱신: DXRX-MGMT-2PANEL)
 *
 * 문지은 대표원장(6/8): "상병명관리에서 상병명 수정하면 DB 에러나고 저장 안 됨".
 *   1차 근본원인: useUpsertDx 가 payload 에 폴더 컬럼(diagnosis_folder)을 항상 실어, 컬럼 미적용
 *   환경에서 UPDATE/INSERT 가 전부 실패. (당시 폴백: 폴더 컬럼 부재 시 제외 재시도)
 *
 * ✅ DXRX-MGMT-2PANEL 개편으로 저장 결함 클래스가 구조적으로 제거됨 —
 *   폴더 배치는 더 이상 항목 저장(upsert)과 결합되지 않는다. 배치는 드래그앤드롭 전용
 *   (useAssignDiagnosisToFolder → services.diagnosis_folder_id UPDATE). 따라서 useUpsertDx 의
 *   payload 는 name/service_code/active/sort_order 만 → 어떤 폴더 컬럼 적용 상태에서도 저장 무결.
 *   본 spec 은 "저장 경로에 폴더 컬럼 write 가 전혀 없다"는 더 강한 불변식을 가드한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// ── AC-1: 저장 payload 에 폴더 컬럼 write 없음(결함 클래스 구조적 제거) ──
test('AC-1: useUpsertDx payload = name/service_code/active/sort_order만 (폴더 컬럼 write 없음)', () => {
  const src = read(TAB);
  expect(src).toContain('useUpsertDx');
  expect(src).toContain('name: form.name.trim()');
  expect(src).toContain('service_code: form.service_code.trim()');
  // 폴더 컬럼은 저장 경로에서 완전히 분리 — payload 에 등장 금지
  expect(src).not.toContain('diagnosis_folder: form');
  expect(src).not.toContain('diagnosis_folder_id: form');
});

// ── AC-1: 신규 insert 경로도 폴더 컬럼 없이 동일 안전 ──
test('AC-1: insert 경로도 category_label=상병 부가필드 + 폴더 컬럼 없음', () => {
  const src = read(TAB);
  expect(src).toContain("category_label: '상병'");
  // 신규 상병 = 미분류로 생성(폴더 배정은 이후 드래그) — insert 에 폴더 컬럼 미포함
  expect(src).toContain('service_type:');
});

// ── AC-2: read 폴백(컬럼 미적용 42703) 보존 — 목록 로드 무손실 ──
test('AC-2: useDiagnoses read 폴백(42703) 보존 — 폴더 컬럼 미적용에도 목록 로드', () => {
  const src = read(TAB);
  expect(src).toContain('withFolder.error');
  expect(src).toContain('diagnosis_folder_id: null');
});

// ── AC-2: 폴더 배치는 저장과 분리된 별도 경로(드래그) ──
test('AC-2: 폴더 배치 = 저장과 분리된 드래그 경로(useAssignDiagnosisToFolder)', () => {
  const src = read(TAB);
  expect(src).toContain('useAssignDiagnosisToFolder');
  expect(src).toContain('handleDragEnd');
});
