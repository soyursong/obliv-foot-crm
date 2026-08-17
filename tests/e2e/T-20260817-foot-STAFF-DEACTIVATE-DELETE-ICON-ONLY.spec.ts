/**
 * E2E Spec: T-20260817-foot-STAFF-DEACTIVATE-DELETE-ICON-ONLY
 * 직원.공간 > 직원 탭 목록 각 행의 '비활성'/'삭제' 버튼 — 텍스트 라벨 제거 → 아이콘만 노출.
 *
 * 부모: T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT(deployed) 의 UI 후속정리.
 *   순수 시각 표현 정리(db_change=false·순수 FE). 버튼 동작·권한·soft-delete 로직 전건 무변.
 *
 * 요구사항:
 *   - 비활성: 아이콘만(PowerOff, 회색 유지) / 삭제: 쓰레기통 아이콘(Trash2)만(빨강 destructive 유지)
 *   - hover tooltip(title) + aria-label 로 설명 유지(접근성)
 *
 * mechanism = JSX 표현 정리(라벨 텍스트 노드 제거). 이 spec 은 Staff.tsx 소스의
 *   버튼 구조 불변식(라벨 부재 · 아이콘 존치 · title+aria-label 존치 · 색상 클래스 존치)을 검증한다.
 *   (page/auth/server 불요 — 순수 소스 assertion.)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STAFF_TSX = path.resolve(__dirname, '../../src/pages/Staff.tsx');

function readStaff(): string {
  return fs.readFileSync(STAFF_TSX, 'utf-8');
}

/** 소스에서 특정 title 속성을 가진 <Button ...>...</Button> 블록을 추출 */
function extractButtonByTitle(src: string, titleFragment: string): string {
  const idx = src.indexOf(titleFragment);
  expect(idx, `title 조각 "${titleFragment}" 을 소스에서 찾지 못함`).toBeGreaterThan(-1);
  // 해당 위치를 감싸는 <Button ... </Button> 경계 추출
  const openStart = src.lastIndexOf('<Button', idx);
  const closeEnd = src.indexOf('</Button>', idx);
  expect(openStart).toBeGreaterThan(-1);
  expect(closeEnd).toBeGreaterThan(-1);
  return src.slice(openStart, closeEnd + '</Button>'.length);
}

test.describe('T-20260817 STAFF-DEACTIVATE-DELETE-ICON-ONLY — 버튼 아이콘-only 구조', () => {
  const DEACTIVATE_TITLE = '직원 비활성화 (로그인·접근 차단, 데이터 보존)';
  const DELETE_TITLE = '직원 삭제 (목록에서 제거 — 연결된 기록은 보존)';

  // ── (A) 비활성 버튼 ─────────────────────────────────────────
  test('A1: 비활성 버튼 — PowerOff 아이콘 존치', () => {
    const btn = extractButtonByTitle(readStaff(), DEACTIVATE_TITLE);
    expect(btn).toContain('<PowerOff');
  });

  test('A2: 비활성 버튼 — 텍스트 라벨 "비활성" 노드 제거(아이콘만)', () => {
    const btn = extractButtonByTitle(readStaff(), DEACTIVATE_TITLE);
    // 아이콘 태그를 제거한 나머지에서 가시 텍스트 '비활성' 이 없어야 함
    const withoutIcons = btn.replace(/<[^>]*\/>/g, '').replace(/<\/?[A-Za-z][^>]*>/g, '');
    expect(withoutIcons).not.toContain('비활성');
  });

  test('A3: 비활성 버튼 — title(hover) + aria-label(접근성) 유지', () => {
    const btn = extractButtonByTitle(readStaff(), DEACTIVATE_TITLE);
    expect(btn).toContain(`title="${DEACTIVATE_TITLE}"`);
    expect(btn).toContain(`aria-label="${DEACTIVATE_TITLE}"`);
  });

  test('A4: 비활성 버튼 — 회색 계열 클래스 유지(색상 무변)', () => {
    const btn = extractButtonByTitle(readStaff(), DEACTIVATE_TITLE);
    expect(btn).toContain('bg-neutral-200');
    expect(btn).toContain('text-neutral-700');
  });

  // ── (B) 삭제 버튼 ───────────────────────────────────────────
  test('B1: 삭제 버튼 — Trash2 아이콘 존치', () => {
    const btn = extractButtonByTitle(readStaff(), DELETE_TITLE);
    expect(btn).toContain('<Trash2');
  });

  test('B2: 삭제 버튼 — 텍스트 라벨 "삭제" 노드 제거(아이콘만)', () => {
    const btn = extractButtonByTitle(readStaff(), DELETE_TITLE);
    const withoutIcons = btn.replace(/<[^>]*\/>/g, '').replace(/<\/?[A-Za-z][^>]*>/g, '');
    expect(withoutIcons).not.toContain('삭제');
  });

  test('B3: 삭제 버튼 — title(hover) + aria-label(접근성) 유지', () => {
    const btn = extractButtonByTitle(readStaff(), DELETE_TITLE);
    expect(btn).toContain(`title="${DELETE_TITLE}"`);
    expect(btn).toContain(`aria-label="${DELETE_TITLE}"`);
  });

  test('B4: 삭제 버튼 — destructive(빨강) variant 유지(색상 무변)', () => {
    const btn = extractButtonByTitle(readStaff(), DELETE_TITLE);
    expect(btn).toContain('variant="destructive"');
  });

  // ── (C) 동작 불변식 ─────────────────────────────────────────
  test('C1: onClick 핸들러 무변 — 비활성=handleToggleActive, 삭제=requestDelete', () => {
    const src = readStaff();
    const deactivate = extractButtonByTitle(src, DEACTIVATE_TITLE);
    const del = extractButtonByTitle(src, DELETE_TITLE);
    expect(deactivate).toContain('handleToggleActive(s)');
    expect(del).toContain('requestDelete(s)');
  });
});
