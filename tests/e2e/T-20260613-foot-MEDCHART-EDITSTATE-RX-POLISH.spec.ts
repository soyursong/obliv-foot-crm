/**
 * E2E spec — T-20260613-foot-MEDCHART-EDITSTATE-RX-POLISH (P2)
 * 진료차트(MedicalChartPanel + DiagnosisFolderPicker) 3차 폴리시.
 * 100% FE presentation — DB/저장/비즈로직 무변경.
 * 선행 EDITMODE-RXTABLE-LAYOUT-POLISH(aab901c/97524b8) 위에 reporter 3차 델타 반영.
 *
 * ⚠ AC-2 는 선행 EDITMODE AC-3(teal '편집 중' 배지)를 supersede — '과한 색' 금지,
 *   미니멀 흑백 톤으로 전환. AC-4 는 DIAG-RX AC-4 '테두리 전제거'를 부분 supersede(경계 구분선만 복원).
 *
 * AC 매핑:
 *  AC-1 [DELTA] 빨강/파랑 닷 → 평상시 숨김, 연필(편집)모드에서만 노출 (선행 기구현 회귀 가드).
 *  AC-2 [NEW·supersede] 편집/읽기 시각 구분을 미니멀 흑백 톤으로 — 배지 teal 제거(회색), 편집 시 패널 옅은 회색 배경.
 *  AC-3 [재확인] 연필 토글 왼쪽 배치(회귀 가드).
 *  AC-4 [REDEFINE] 처방내역 행 구분선 가시성 복원(border-gray-200) + 진단명|처방 좌측 세로선.
 *  AC-5 [DELTA] '___ 외 N건' 읽기전용 시 버튼/꺾쇠 제거 → 평문(회귀 가드).
 *  AC-6 [DELTA] 진료일/진료의 한 줄 + 담당의 우측 끝 오른정렬(sm:ml-auto) (회귀 가드).
 *  AC-7 [NEW] 진단명/처방내역 헤더 베이스라인 통일(min-h) + 좌측 폼 헤더 text-xs 통일 회귀 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');
const PICKER = () => SRC('components/medical/DiagnosisFolderPicker.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 편집 상태 시각화 (닷 + 미니멀 흑백 톤)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1: 편집 상태 시각화', () => {
  test('AC-1 빨강/파랑 닷은 specialNoteEditing(편집)일 때만 노출 — 읽기 모드 숨김', () => {
    const src = PANEL();
    expect(src).toMatch(/specialNoteEditing && \([\s\S]{0,160}data-testid="special-note-color-dots"/);
    expect(src).toContain('data-testid="special-note-dot-red"');
    expect(src).toContain('data-testid="special-note-dot-blue"');
  });

  test('AC-2 편집 배지는 미니멀 흑백 톤(teal/과한 색 제거)', () => {
    const src = PANEL();
    // 배지 노출 조건 유지(편집 시에만).
    expect(src).toMatch(/specialNoteEditing && \([\s\S]{0,400}special-note-editing-badge/);
    // 배지가 흑백(gray) 톤 — teal 강조색 금지.
    const badgeBlock = src.slice(
      src.indexOf('data-testid="special-note-editing-badge"') - 240,
      src.indexOf('data-testid="special-note-editing-badge"') + 40,
    );
    expect(badgeBlock).toMatch(/text-gray-600/);
    expect(badgeBlock).not.toMatch(/teal/);
  });

  test('AC-2 편집 모드 패널 — 옅은 회색 배경(흑백 톤)으로 읽기 모드와 시각 구분', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="special-note-panel"');
    // 편집(연필 ON)일 때만 회색 배경/링 — 과한 색 없이 그레이스케일.
    expect(src).toMatch(/specialNoteEditing \? 'rounded-md bg-gray-50 ring-1 ring-gray-200/);
  });

  test('AC-3 연필 토글이 펼침 토글보다 소스상 왼쪽(먼저) — 회귀 가드', () => {
    const src = PANEL();
    const editIdx = src.indexOf('data-testid="special-note-edit-toggle"');
    const openIdx = src.indexOf('data-testid="special-note-toggle"');
    expect(editIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeLessThan(openIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 처방내역 구분선
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2: 처방내역 구분선', () => {
  test('AC-4 처방내역 행 구분선 가시성 복원 — border-gray-200', () => {
    const src = PANEL();
    expect(src).toMatch(/border-b border-gray-200 last:border-b-0[\s\S]{0,80}prescription-row-/);
  });

  test('AC-4 진단명↔처방 좌측 세로 구분선 1개(sm:border-l) 유지', () => {
    const src = PANEL();
    expect(src).toMatch(/sm:flex-\[1\.5\] min-w-0 sm:border-l sm:border-gray-200 sm:pl-3/);
  });

  test('AC-5 읽기전용 시 "외 N건"이 버튼/꺾쇠 없는 평문(div) — 회귀 가드', () => {
    const src = PICKER();
    // disabled(읽기전용) 분기는 button/ChevronDown 없는 div 로 렌더.
    expect(src).toMatch(/disabled \? \([\s\S]{0,120}<div[\s\S]{0,400}triggerLabel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 진료일/담당의 정렬
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3: 진료일/담당의 정렬', () => {
  test('AC-6 진료일·진료의 한 줄(flex-row) + 담당의 우측 끝(sm:ml-auto)', () => {
    const src = PANEL();
    expect(src).toMatch(/flex flex-col sm:flex-row sm:items-end[\s\S]{0,80}chart-date-doctor-row/);
    expect(src).toMatch(/min-w-0 sm:ml-auto sm:flex sm:flex-col sm:items-end[\s\S]{0,80}signing-doctor-select-block/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4 — 전체 정렬/헤더
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 4: 전체 정렬/헤더', () => {
  test('AC-7 진단명/처방내역 헤더 베이스라인 통일 — 양쪽 min-h-[1.125rem]', () => {
    const src = PANEL();
    const count = (src.match(/mb-1 min-h-\[1\.125rem\]/g) || []).length;
    // 진단명 + 처방내역 두 헤더 행 모두 동일 min-h 적용.
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('AC-7 좌측 폼 섹션 헤더 text-xs 통일 — MEMO-TIMELINE 회귀 가드', () => {
    const src = PANEL();
    for (const label of ['진료일', '담당 의사', '진단명', '처방내역', '치료사차트', '치료메모', '임상경과']) {
      expect(src).toContain(label);
    }
    // 통일 토큰(text-xs font-semibold text-muted-foreground)이 다수 유지.
    const xs = (src.match(/text-xs font-semibold text-muted-foreground/g) || []).length;
    expect(xs).toBeGreaterThanOrEqual(6);
  });
});
