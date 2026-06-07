/**
 * E2E spec — T-20260607-foot-DXMGMT-LEFT-FOLDER-FIX
 *
 * 문지은 대표원장(6/7, C0ATE5P6JTH): "상병명관리에 좌측에 폴더구조 안뜸".
 *   상병명관리(DiagnosisNamesTab)를 2패널(좌:폴더트리 / 우:상병목록)로 전환해
 *   좌측 폴더트리 패널이 정상 렌더되도록 회귀 수정.
 *
 * 관련: T-20260607-foot-DX-MGMT-DND-SORT(deployed, DnD 정렬) ·
 *       T-20260607-foot-DXRX-MGMT-2PANEL(DB additive FK 마이그).
 *
 * 본 spec 은 2패널 구조 불변식(좌측 폴더트리 패널 상존·빈 상태 안내·선택→우측 목록·
 *   기존 DnD 회귀 보존)을 정본 그대로 인코딩해 회귀를 가드한다(데이터/로그인 비의존, 소스 정적 검증).
 *   현장 클릭 시나리오 2종(티켓 본문)을 구조 단언으로 변환.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// ── AC-1: 좌측 폴더트리 패널 + 클릭 가능한 폴더 노드 ──
test('AC-1: 좌측 폴더트리 패널(dx-folder-tree)과 폴더 노드(dx-folder-node) 렌더', () => {
  const src = read(TAB);
  expect(src).toContain('dx-folder-tree');
  expect(src).toContain('dx-folder-node');
  // 폴더 선택 상태 + 핸들러
  expect(src).toContain('selectedFolder');
  expect(src).toContain('setSelectedFolder');
  // 폴더 노드 클릭 → 선택
  expect(src).toContain('onSelect');
});

// ── AC-2: 폴더 0건이어도 좌측 패널 컨테이너 상존 + 빈 상태 안내 ──
test('AC-2: 빈 폴더 상태에서도 패널 유지 + "폴더 없음" 안내(렌더 실패와 0건 구분)', () => {
  const src = read(TAB);
  expect(src).toContain('dx-folder-empty');
  expect(src).toContain('폴더 없음');
  // 빈 분기는 folderOrder.length === 0 으로 판정(데이터 0건 ≠ 렌더 실패)
  expect(src).toContain('folderOrder.length === 0');
});

// ── AC-3: 2패널 레이아웃(좌:폴더 / 우:상병 목록) + 좌측 폭·스크롤 ──
test('AC-3: 2패널 grid 레이아웃 + 좌측 고정폭·스크롤', () => {
  const src = read(TAB);
  // 좌측 고정폭 + 우측 가변(min 0) 2컬럼 그리드
  expect(src).toContain('md:grid-cols-[220px_minmax(0,1fr)]');
  // 좌측 패널 스크롤(긴 폴더 목록)
  expect(src).toContain('overflow-y-auto');
  // 우측 = 선택 폴더의 상병 목록
  expect(src).toContain('dx-folder-items');
  expect(src).toContain("itemsByFolder.get(selectedFolder)");
});

// ── AC-4: 기존 DnD 정렬(DX-MGMT-DND-SORT) 회귀 없음 ──
test('AC-4: 폴더/항목 DnD 핸들러·@dnd-kit 보존 (DND-SORT 회귀 가드)', () => {
  const src = read(TAB);
  // 신규 경쟁 라이브러리 도입 금지
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).not.toContain('react-beautiful-dnd');
  expect(src).not.toContain('@hello-pangea/dnd');
  // 폴더/항목 양쪽 드래그 핸들러 보존
  expect(src).toContain('handleFolderDragEnd');
  expect(src).toContain('handleItemDragEnd');
  expect(src).toContain('applyReorder');
  // 핸들 + grab 커서 보존
  expect(src).toContain('dx-folder-handle');
  expect(src).toContain('dx-item-handle');
  expect(src).toContain('cursor-grab');
  expect(src).toContain('touch-none');
  // admin 전용 reorder 게이트 보존(AC-3 of DND-SORT)
  expect(src).toContain('canReorder');
});

// ── 시나리오 1(정상 동선): 폴더 선택 → 우측 목록 ──
test('시나리오1: 선택 폴더 무효 시 첫 폴더 자동 선택(선택 항상 유효)', () => {
  const src = read(TAB);
  expect(src).toContain('folderOrder.includes(selectedFolder)');
  expect(src).toContain('setSelectedFolder(folderOrder[0])');
});

// ── 시나리오 2(빈 폴더): 선택 폴더에 항목 0건이어도 우측 영역 유지 ──
test('시나리오2: 선택 폴더 항목 0건일 때 우측 빈 상태 안내', () => {
  const src = read(TAB);
  expect(src).toContain('이 폴더에 등록된 상병명이 없습니다');
});
