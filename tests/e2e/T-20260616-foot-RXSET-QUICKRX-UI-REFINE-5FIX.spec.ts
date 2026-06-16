/**
 * T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX
 * 처방세트 약 검색영역(①②③) + 빠른처방 생성화면(④⑤) UX 리파인 5건
 * 문지은 대표원장 (MSG-20260616-205608-jl4b)
 *
 * 용어 그라운딩(실코드 확인): 현장용어 "처방세트" = 약 분류/탐색 도구 = drug_folders = DrugFoldersTab
 *   (DrugFoldersTab 배너 "처방세트 = 약을 분류·탐색하는 도구"). 따라서 ①②③(처방세트 화면 우측
 *   약 검색 영역)의 실제 surface 는 PrescriptionSetsTab 이 아니라 DrugFoldersTab 우측 패널이다.
 *   ④⑤(빠른처방 생성) = QuickRxButtonsTab. (planner 1차 그라운딩은 파일명 혼동 → dev-foot 실코드 정정)
 *
 * AC-1: 약 검색창 외겹 라운드박스(rounded-lg border bg-card) 제거 — input 자체만 유지
 * AC-2: 분류 약물 목록 라운드박스(카드) → 데이터테이블(헤더행+약물명행)
 * AC-3: 삭제(분류해제) 직접노출 제거 → "…"(더보기) + 팝업 "삭제하기" 확인 후에만 실행
 * AC-4: 빠른처방 이모지/아이콘 제거 → 차분한 모노톤 색상 태그(pill), icon 컬럼 재활용(db_change=false)
 * AC-5: 빠른처방 `<` 연결을 처방세트 "폴더 구조" 표기로 통일(PrescriptionSetTreePicker folder→set 유지)
 * AC-6: 회귀 없음 — 분류/해제 mutation·검색·연결·권한가드 동작 보존
 *
 * 정적 소스 검사(레포 관례) + 색상 팔레트 로직 재현.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const drugFoldersSrc = readFileSync(resolve(ROOT, 'src/components/admin/DrugFoldersTab.tsx'), 'utf8');
const quickRxSrc = readFileSync(resolve(ROOT, 'src/components/admin/QuickRxButtonsTab.tsx'), 'utf8');
const quickRxBarSrc = readFileSync(resolve(ROOT, 'src/components/doctor/QuickRxBar.tsx'), 'utf8');
const paletteSrc = readFileSync(resolve(ROOT, 'src/lib/quickRxColors.ts'), 'utf8');

// ── AC-1: 검색창 외겹 라운드박스 제거 ────────────────────────────────────────
test.describe('AC-1 — 약 검색창 외겹 라운드박스 제거', () => {
  test('검색 input 을 감싸던 rounded-lg border bg-card 컨테이너 제거', () => {
    // 검색 input 은 유지
    expect(drugFoldersSrc).toContain('data-testid="drug-folder-assign-search"');
    // 외겹 카드 박스(검색영역 래퍼) 제거 — 이전: <div className="rounded-lg border bg-card p-2 space-y-1.5">
    expect(drugFoldersSrc).not.toContain('rounded-lg border bg-card p-2 space-y-1.5');
  });
});

// ── AC-2: 약물 목록 → 데이터테이블 ──────────────────────────────────────────
test.describe('AC-2 — 분류 약물 목록 데이터테이블', () => {
  test('분류 약물 목록이 <table> 데이터테이블 구조(헤더행 포함)', () => {
    expect(drugFoldersSrc).toContain('data-testid="drug-folder-assigned-table"');
    expect(drugFoldersSrc).toContain('<thead>');
    expect(drugFoldersSrc).toContain('약물명');
    expect(drugFoldersSrc).toContain('보험코드');
    // 행 testid 보존(AC-6 회귀)
    expect(drugFoldersSrc).toContain('data-testid="drug-folder-assigned-item"');
  });

  test('행이 카드(rounded-md border bg-muted/20) 형태가 아님', () => {
    expect(drugFoldersSrc).not.toContain('rounded-md border px-2 py-1.5 bg-muted/20');
  });
});

// ── AC-3: 삭제 "…" 더보기 + 팝업 확인 ───────────────────────────────────────
test.describe('AC-3 — 삭제 더보기 버튼 + 팝업 확인', () => {
  test('행 삭제는 더보기("…") 버튼 뒤 팝업의 "삭제하기"에서만 실행', () => {
    // 더보기 버튼 + 메뉴
    expect(drugFoldersSrc).toContain('data-testid="drug-folder-row-more-btn"');
    expect(drugFoldersSrc).toContain('data-testid="drug-folder-row-more-menu"');
    expect(drugFoldersSrc).toContain('data-testid="drug-folder-row-delete-action"');
    expect(drugFoldersSrc).toContain('삭제하기');
    // 더보기 메뉴 컴포넌트가 onDelete 로 handleUnassign 을 호출(직접노출 X)
    expect(drugFoldersSrc).toContain('onDelete={() => handleUnassign(d)}');
  });

  test('바깥클릭/ESC 닫힘 가드 존재(경량 인라인 popover)', () => {
    expect(drugFoldersSrc).toContain("e.key === 'Escape'");
    expect(drugFoldersSrc).toContain('mousedown');
  });
});

// ── AC-4: 색상 태그(아이콘 제거) ────────────────────────────────────────────
test.describe('AC-4 — 빠른처방 색상 태그', () => {
  test('빠른처방 다이얼로그가 색상 팔레트(이모지/아이콘 picker 아님)', () => {
    expect(quickRxSrc).toContain('data-testid="quick-rx-color-palette"');
    expect(quickRxSrc).toContain('QUICK_RX_COLORS.map');
    // 아이콘 picker 제거
    expect(quickRxSrc).not.toContain('data-testid="quick-rx-icon-picker"');
  });

  test('처방세트명이 선택 색상 태그(chip)에 표시 — 미리보기/목록', () => {
    expect(quickRxSrc).toContain('quickRxChipClass');
    expect(quickRxSrc).toContain('data-testid="quick-rx-color-preview-chip"');
    expect(quickRxSrc).toContain('data-testid="quick-rx-btn-name-chip"');
  });

  test('영속화는 신규 컬럼 없이 icon 컬럼 재활용 — payload icon: form.icon 보존', () => {
    expect(quickRxSrc).toContain('icon: form.icon');
    expect(quickRxSrc).toContain('DEFAULT_QUICK_RX_COLOR');
  });

  test('진료화면 QuickRxBar 도 아이콘 대신 색상 닷 렌더', () => {
    expect(quickRxBarSrc).toContain('quickRxDotClass(btn.icon)');
    expect(quickRxBarSrc).not.toContain('IconRenderer icon={btn.icon}');
  });

  test('색상 팔레트는 차분한 모노톤 — 형광/고채도(-500/-600 배경) 배제', () => {
    // 칩 배경은 -50/-100 저채도만 사용
    expect(paletteSrc).not.toMatch(/chip:\s*'bg-\w+-(500|600|700)/);
    // 최소 4색 이상 큐레이션
    const count = (paletteSrc.match(/value:\s*'/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

// ── AC-5: 처방세트 폴더 구조 연결 ───────────────────────────────────────────
test.describe('AC-5 — 처방세트 폴더 구조 연결', () => {
  test('연결 picker 가 folder→set 트리(PrescriptionSetTreePicker) 유지 + 폴더 구조 표기', () => {
    expect(quickRxSrc).toContain('PrescriptionSetTreePicker');
    expect(quickRxSrc).toContain('data-testid="quick-rx-set-tree"');
    expect(quickRxSrc).toContain('폴더 구조');
  });

  test('FK 불변(db_change=false) — prescription_set_id 연결 유지', () => {
    expect(quickRxSrc).toContain('prescription_set_id: s.id');
  });
});

// ── AC-4 팔레트 로직 재현(빌드 의존 없이 동작 검증) ─────────────────────────
test.describe('AC-4 팔레트 폴백 로직', () => {
  function chip(token: string | null | undefined, table: Record<string, string>): string {
    const FALLBACK = 'bg-slate-100 text-slate-700 border-slate-300';
    if (!token) return FALLBACK;
    return table[token] ?? FALLBACK;
  }
  test('레거시 아이콘값(pill)은 slate 폴백, 유효 토큰은 매핑', () => {
    const table = { sky: 'bg-sky-50 text-sky-700 border-sky-200' };
    expect(chip('sky', table)).toBe('bg-sky-50 text-sky-700 border-sky-200');
    expect(chip('pill', table)).toBe('bg-slate-100 text-slate-700 border-slate-300'); // 레거시 → 폴백
    expect(chip(null, table)).toBe('bg-slate-100 text-slate-700 border-slate-300');
  });
});
