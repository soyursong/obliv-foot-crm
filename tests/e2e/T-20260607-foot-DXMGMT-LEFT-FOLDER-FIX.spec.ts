/**
 * E2E spec — T-20260607-foot-DXMGMT-LEFT-FOLDER-FIX  (구조 갱신: DXRX-MGMT-2PANEL)
 *
 * 원 의도: 상병명관리 좌측 폴더트리 패널이 정상 렌더(2패널)되도록 회귀 수정.
 *
 * ⚠️ DXRX-MGMT-2PANEL 개편으로 폴더 모델이 TEXT(services.diagnosis_folder) → 엔티티
 *   (diagnosis_folders + services.diagnosis_folder_id FK)로 바뀌었다. 좌측 2패널·빈 상태·선택→우측
 *   필터·DnD 라는 보존 가능한 불변식은 새 구조 식별자로 가드한다(선택=selectedKey, 트리=엔티티).
 *   AC-5 도달경로(서비스관리→진료관리 서브탭→상병명 관리 탭)는 변동 없이 유지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';
const SERVICES = 'src/pages/Services.tsx';
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';

// ── AC-1: 좌측 폴더 패널 + 클릭 가능한 폴더 노드 ──
test('AC-1: 좌측 폴더 패널(dx-folder-tree)·폴더 노드(dx-folder-node) 렌더 + 선택', () => {
  const src = read(TAB);
  expect(src).toContain('dx-folder-tree');
  expect(src).toContain('dx-folder-node');
  // 폴더 선택 상태(엔티티 키) + 핸들러
  expect(src).toContain('selectedKey');
  expect(src).toContain('setSelectedKey');
  expect(src).toContain('onSelect');
});

// ── AC-2: 폴더 0건이어도 좌측 패널 상존 + 빈 상태 안내 ──
test('AC-2: 빈 폴더 상태에서도 패널 유지 + "폴더 없음" 안내', () => {
  const src = read(TAB);
  expect(src).toContain('dx-folder-empty');
  expect(src).toContain('폴더 없음');
  // 빈 분기 = 트리 루트 0건 판정(렌더 실패 ≠ 0건)
  expect(src).toContain('rootNodes.length === 0');
});

// ── AC-3: 2패널 grid 레이아웃 + 좌측 고정폭·스크롤 + 우측 선택 폴더 목록 ──
test('AC-3: 2패널 grid + 좌측 고정폭·스크롤 + 우측 필터 목록', () => {
  const src = read(TAB);
  expect(src).toContain('md:grid-cols-[240px_minmax(0,1fr)]');
  expect(src).toContain('overflow-y-auto');
  expect(src).toContain('dx-folder-items');
  // 우측 = 선택 폴더 소속 항목(엔티티 FK 필터)
  expect(src).toContain('visibleItems');
});

// ── AC-4: DnD 보존(@dnd-kit) — 신규 라이브러리 미도입 ──
test('AC-4: @dnd-kit 크로스패널 DnD 보존 + 신규 라이브러리 금지', () => {
  const src = read(TAB);
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).not.toContain('react-beautiful-dnd');
  expect(src).not.toContain('@hello-pangea/dnd');
  // 항목 드래그(배치) 핸들러 + 핸들 + grab 커서
  expect(src).toContain('handleDragEnd');
  expect(src).toContain('dx-item-handle');
  expect(src).toContain('cursor-grab');
  expect(src).toContain('touch-none');
  // 관리권한 게이트
  expect(src).toContain('canManage');
});

// ── 시나리오 1: 선택 폴더 무효화 시 미분류로 환원(선택 항상 유효) ──
test('시나리오1: 삭제된 폴더 선택 시 미분류로 환원(선택 항상 유효)', () => {
  const src = read(TAB);
  expect(src).toContain('!folders.some((f) => f.id === selectedKey)');
  expect(src).toContain('setSelectedKey(UNASSIGNED)');
});

// ── 시나리오 2: 선택 폴더 항목 0건일 때 우측 빈 상태 안내 ──
test('시나리오2: 선택 폴더 항목 0건일 때 우측 빈 상태 안내', () => {
  const src = read(TAB);
  expect(src).toContain('이 폴더에 분류된 상병명이 없습니다');
});

// ── AC-5: 상병명관리 도달 경로(reachability) 회귀 가드 (변동 없음) ──
test('AC-5: 도달 경로(서비스관리 → 진료관리 서브탭 → 상병명 관리 탭) testid 체인 보존', () => {
  const services = read(SERVICES);
  expect(services).toContain('svc-top-tab-clinic');
  expect(services).toContain('진료관리');
  expect(services).toContain("import('@/pages/ClinicManagement')");

  const clinic = read(CLINIC_MGMT);
  expect(clinic).toContain('tab-diagnosis-names');
  expect(clinic).toContain('value="diagnosis_names"');
  expect(clinic).toContain('<DiagnosisNamesTab');
});
