/**
 * E2E spec — T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH (P1)
 * 진료차트(MedicalChartPanel + DiagnosisFolderPicker) UI 폴리시 4묶음.
 * 100% FE presentation — DB/저장/비즈로직 무변경. DIAG-RX-TABLEVIEW-REFINE(099c3ee) +
 * MEMO-TIMELINE-REFINE(dc466fc) deploy-ready 2건 위에서 작업.
 *
 * 기구현(2COL / DATE-DIAG / DIAG-RX / MEMO-TIMELINE) presentation 검증 컨벤션을 따라
 * 소스 정적 검증 + 회귀 가드로 구성한다.
 *
 * AC 매핑:
 *  A. 편집모드 UI (특이사항 헤더 — 연필/토글/상태닷)
 *   AC-1 연필 버튼이 펼침 토글 왼쪽에 위치(검증/유지).
 *   AC-2 빨강/파랑 상태닷 → 편집(연필 ON) 상태일 때만 노출, 기본(읽기) 숨김.
 *   AC-3 편집 vs 일반 텍스트 시각 구분 — 편집 시 teal '편집 중' 배지(색상 1택).
 *  B. 처방내역 테이블
 *   AC-4 처방내역 행 간 가로 구분선(border-b) 추가.
 *   AC-5 좌측 진단명 영역과 처방 내용 사이 세로 구분선 1개(sm:border-l).
 *   AC-6 '___ 외 N건' 트리거: 읽기전용 시 버튼형 → 일반 텍스트(클릭불가·꺾쇠 제거).
 *  C. 진료일/진료의
 *   AC-7 진료일 ___ 진료의 ___ 한 줄 수평 배치(검증/유지 — DIAG-RX AC-5 동일방향).
 *   AC-8 담당의 표시 오른쪽 정렬, 행 가장 끝(sm:ml-auto).
 *  D. 전체 타이포·정렬
 *   AC-9 진료차트(좌측 폼) 섹션 헤더 글씨 크기 통일(text-xs) — MEMO-TIMELINE 회귀 가드.
 *   AC-10/11 정렬·여백 정돈(AC-5 세로선 여백 + AC-8 우측정렬 반영).
 *
 *  REDEFINITION 화해(B): DIAG-RX AC-4 '무거운 외곽/버튼 테두리 제거'는 유지하고,
 *  그 위에 얇은 가로 행 구분선 + 좌측 세로 구분선 1개만 덧댄다('테두리 전부 복원' 아님).
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
// 현장 시나리오 1 — 편집모드 토글 + 상태닷
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. 편집모드 UI (현장 시나리오 1: 편집모드 토글+상태닷)', () => {
  test('AC-1 연필 토글이 특이사항 펼침 토글보다 왼쪽(소스상 먼저)에 위치', () => {
    const src = PANEL();
    const editIdx = src.indexOf('data-testid="special-note-edit-toggle"');
    const openIdx = src.indexOf('data-testid="special-note-toggle"');
    expect(editIdx).toBeGreaterThan(0);
    expect(openIdx).toBeGreaterThan(0);
    // 같은 flex 행에서 연필이 펼침 토글보다 먼저 = 왼쪽.
    expect(editIdx).toBeLessThan(openIdx);
    // 연필은 펼친 상태에서만 노출(읽기 기본 — 오기입 방지).
    expect(src).toMatch(/specialNoteOpen && \([\s\S]{0,600}special-note-edit-toggle/);
  });

  test('AC-2 빨강/파랑 상태닷은 편집(specialNoteEditing) 상태일 때만 노출', () => {
    const src = PANEL();
    // 컬러 닷 묶음(span)이 specialNoteEditing 게이트로 감싸짐.
    expect(src).toMatch(/specialNoteEditing && \([\s\S]{0,160}data-testid="special-note-color-dots"/);
    // 닷 자체(red/blue)는 유지.
    expect(src).toContain('data-testid="special-note-dot-red"');
    expect(src).toContain('data-testid="special-note-dot-blue"');
    // 닷 숨김 시에도 메타(날짜/기록자)는 우측 고정(ml-auto).
    expect(src).toMatch(/ml-auto[^"]*"\s*\n?\s*data-testid="special-note-meta"|ml-auto[\s\S]{0,80}data-testid="special-note-meta"/);
  });

  test('AC-3 편집 상태 시각 구분 — teal "편집 중" 배지(편집 시에만)', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="special-note-editing-badge"');
    // 배지는 specialNoteEditing 일 때만.
    expect(src).toMatch(/specialNoteEditing && \([\s\S]{0,400}special-note-editing-badge/);
    // 색상 1택(teal) 적용.
    expect(src).toMatch(/text-teal-600[\s\S]{0,120}special-note-editing-badge|special-note-editing-badge[\s\S]{0,120}편집 중/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 현장 시나리오 2 — 처방내역 표현(행 구분선 / 세로선 / 외 N건 평문)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B. 처방내역 테이블 (현장 시나리오 2: 처방내역 표현)', () => {
  test('AC-4 처방내역 행(tr)에 가로 구분선(border-b) 추가, 마지막행 제거', () => {
    const src = PANEL();
    expect(src).toMatch(/<tr\s+key=\{idx\}\s+className="border-b border-gray-100 last:border-b-0"/);
    // 회귀 가드: DIAG-RX AC-4 무거운 외곽/버튼 테두리 제거는 '유지'.
    expect(src).toContain('[&_input]:border-0 [&_input]:shadow-none [&_input]:bg-transparent [&_button]:border-0');
  });

  test('AC-5 진단명↔처방 사이 세로 구분선 1개(sm:border-l) — 우컬럼에만', () => {
    const src = PANEL();
    // 처방내역 컬럼 div 에 좌측 세로선 + 여백.
    expect(src).toContain('sm:flex-[1.5] min-w-0 sm:border-l sm:border-gray-200 sm:pl-3');
    // 세로선은 1개 — 진단명(좌) 컬럼엔 border-l 없음(우컬럼 단독).
    const dxCol = src.match(/data-testid="chart-dx-rx-row"[\s\S]{0,600}진단명 \(좌\)/);
    expect(dxCol).not.toBeNull();
  });

  test('AC-6 외 N건 트리거: 읽기전용 시 일반 텍스트(클릭불가·꺾쇠 제거), 편집 시 버튼 유지', () => {
    const src = PICKER();
    // disabled 분기 = 평문 div(클릭불가). 편집 분기 = 기존 button(폴더 진입).
    expect(src).toMatch(/\{disabled \? \([\s\S]{0,400}<div[\s\S]{0,300}triggerLabel/);
    // 평문 분기엔 ChevronDown(꺾쇠) 없음 — disabled div 블록 내 한정.
    const disabledBlock = src.match(/\{disabled \? \(([\s\S]*?)\) : \(/);
    expect(disabledBlock).not.toBeNull();
    expect(disabledBlock![1]).not.toContain('ChevronDown');
    expect(disabledBlock![1]).not.toContain('onClick');
    // 편집(else) 분기엔 폴더 진입 버튼 + ChevronDown(꺾쇠) 유지.
    expect(src).toMatch(/onClick=\{\(\) => setOpen\(\(o\) => !o\)\}/);
    expect(src).toContain('<ChevronDown className="h-4 w-4 text-muted-foreground" />');
    // disabled(평문) 분기가 편집(button) 분기보다 소스상 먼저 — 클릭불가 우선 처리.
    expect(src.indexOf('{disabled ? (')).toBeLessThan(src.indexOf('onClick={() => setOpen((o) => !o)}'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 현장 시나리오 3 — 진료일·진료의 한 줄 + 정렬
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C. 진료일/진료의 (현장 시나리오 3: 한 줄·정렬)', () => {
  test('AC-7 진료일·담당의 한 줄 수평 배치(sm:flex-row, items-end) — 유지', () => {
    const src = PANEL();
    expect(src).toMatch(/data-testid="chart-date-doctor-row"/);
    expect(src).toMatch(/flex flex-col sm:flex-row sm:items-end[\s\S]{0,40}data-testid="chart-date-doctor-row"/);
  });

  test('AC-8 담당의 블록이 행 가장 끝(우측, sm:ml-auto)', () => {
    const src = PANEL();
    expect(src).toContain('min-w-0 sm:ml-auto sm:flex sm:flex-col sm:items-end');
    expect(src).toMatch(/sm:ml-auto[\s\S]{0,80}data-testid="signing-doctor-select-block"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. 타이포·정렬 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D. 타이포·정렬 정돈 (회귀 가드)', () => {
  test('AC-9 좌측 폼 섹션 헤더 글씨 크기 통일(text-xs) — 진료일/담당의/진단명/처방내역/치료사차트/치료메모', () => {
    const src = PANEL();
    for (const label of ['진료일', '담당 의사', '진단명', '처방내역', '치료사차트', '치료메모']) {
      // 각 라벨이 text-xs font-semibold text-muted-foreground 헤더로 렌더.
      const re = new RegExp(`text-xs font-semibold text-muted-foreground[^<]*">\\s*${label}|text-xs font-semibold text-muted-foreground[\\s\\S]{0,40}>${label}<`);
      expect(src).toMatch(re);
    }
  });

  test('AC-10/11 회귀 가드: 데이터/저장 동선(진료의 NOT NULL 강제) 무변경', () => {
    const src = PANEL();
    // 의료법 진료의 NOT NULL 강제(handleSave) 보존.
    expect(src).toContain("toast.error('진료의가 필요합니다 — 담당 의사를 선택해주세요')");
    // 저장 경로(formDx/formRx) 무변경.
    expect(src).toContain('data-testid="medical-chart-diagnosis"');
    expect(src).toContain('data-testid="prescription-items-table"');
  });
});
