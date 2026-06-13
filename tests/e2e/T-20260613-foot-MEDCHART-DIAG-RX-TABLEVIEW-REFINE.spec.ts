/**
 * E2E spec — T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE (문지은 대표원장, P2)
 * 진료차트(MedicalChartPanel + DiagnosisFolderPicker) 진단명·처방내역·진료일/담당의 표현 다듬기.
 *
 * 100% FE presentation(데이터/저장 동선 무변경). 본 스펙은 기구현(2COL / DATE-DIAG) presentation
 * 검증 컨벤션을 따라 소스 정적 검증 + 회귀 가드로 구성한다.
 *
 * AC 매핑:
 *   AC-1 진료차트 Drawer 중앙 본문만 폭 소폭 확대(좌우 칼럼 폭 불변) — full variant width 1440→1520.
 *   AC-2 진단명: '· 등록 상병명 폴더 선택' 문구 제거 + 버튼형(칩)→헤더없는 테이블뷰 [주/부|코드|상병명], 1건 1줄.
 *   AC-3 '___ 외 N건' 요약(트리거)을 선택목록 맨 위로 이동.
 *   AC-4 처방내역: 폭 확대(flex-[1.5]) + 테두리 전부 제거(외곽/내부 input·button).
 *   AC-5 진료일 ___ 담당의 ___ 한 줄 + 담당의 입력칸 슬림(~7.5rem) + 테두리 정리.
 *   AC-6 회귀 가드: 데이터/저장 동선 + 2COL/DATE-DIAG 기구현 배치 무변경.
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
// AC-1 — Drawer 중앙 본문만 폭 확대(좌우 고정폭 불변)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 Drawer 중앙 폭 확대', () => {
  test('full variant Drawer 폭 1520px + 좌(w-56)/우(w-72) 고정폭 불변', () => {
    const src = PANEL();
    // 중앙 본문만 넓히기 위해 Drawer 총폭 확대(좌/우 고정 → 추가폭은 flex-1 중앙으로).
    expect(src).toContain("'min(94vw, 560px)' : 'min(97vw, 1520px)'");
    // 좌측 타임라인 고정폭 w-56 유지.
    expect(src).toMatch(/w-56 flex-shrink-0 border-r[\s\S]{0,80}data-testid="medical-chart-timeline"/);
    // 우측 패널 고정폭 w-72(펼침) 유지.
    expect(src).toContain("rightPanelCollapsed ? 'w-7' : 'w-72'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 진단명: 폴더선택 문구 제거 + 헤더없는 테이블뷰
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 진단명 테이블뷰', () => {
  test('등록 상병명 폴더 선택 안내 문구(span) 제거(기능=트리거 어포던스 유지)', () => {
    const panel = PANEL();
    // 렌더되던 보조문구 span 자체가 제거됨(주석 언급은 허용 — 실제 표시 span 패턴 부재로 판정).
    expect(panel).not.toMatch(/<span[^>]*>· 등록 상병명 폴더 선택<\/span>/);
    // 폴더 선택 진입(picker) 자체는 유지.
    expect(panel).toContain('<DiagnosisFolderPicker');
    expect(panel).toContain('data-testid="medical-chart-diagnosis"');
  });

  test('진단명 칩 → 헤더없는 테이블뷰 [주/부 | 코드 | 상병명], 1건 1줄(tr)', () => {
    const src = PICKER();
    // 테이블뷰(컬럼헤더 thead 없음 — tbody만).
    expect(src).toContain('data-testid="dx-selected-table"');
    expect(src).not.toMatch(/dx-selected-table"[\s\S]{0,200}<thead/);
    // 1건당 한 줄(tr) + 주/부 배지 + 코드 + 상병명.
    expect(src).toMatch(/<tr[\s\S]{0,120}data-testid="dx-chip"/);
    expect(src).toContain('data-testid="dx-chip-badge"');
    expect(src).toMatch(/\{primary \? '주' : '부'\}/);
    expect(src).toContain('const { code, name } = splitDxLabel(label);');
    // 코드 컬럼 bold, 상병명 컬럼 일반.
    expect(src).toMatch(/font-bold font-mono[\s\S]{0,60}\{code\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — '외 N건' 요약(트리거) 맨 위로
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 외 N건 요약 상단 이동', () => {
  test('트리거(외 N건 요약)가 선택 테이블(dx-selected-table)보다 위(먼저)에 렌더', () => {
    const src = PICKER();
    const triggerIdx = src.indexOf('data-testid={rest[\'data-testid\']}');
    const tableIdx = src.indexOf('data-testid="dx-selected-table"');
    expect(triggerIdx).toBeGreaterThan(0);
    expect(tableIdx).toBeGreaterThan(0);
    // 트리거가 테이블보다 소스상 먼저 등장 = 화면 상단.
    expect(triggerIdx).toBeLessThan(tableIdx);
    // 요약 라벨 포맷 유지.
    expect(src).toMatch(/\$\{entries\[0\]\} 외 \$\{entries\.length - 1\}건/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 처방내역 폭 확대 + 테두리 전부 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 처방내역 폭 확대 + 테두리 제거', () => {
  test('처방내역 컬럼 폭 확대(flex-[1.5]) + 외곽/내부 테두리 제거', () => {
    const src = PANEL();
    // 처방내역 컬럼이 진단명보다 넓게(flex-[1.5]).
    expect(src).toMatch(/sm:flex-\[1\.5\] min-w-0/);
    // 처방 테이블 외곽 border 제거 + 내부 input/button 테두리·그림자 제거(arbitrary variant).
    expect(src).toMatch(/\[&_input\]:border-0[\s\S]{0,80}\[&_button\]:border-0[\s\S]{0,40}data-testid="prescription-items-table"/);
    // 행 구분선(border-t) 제거.
    expect(src).not.toMatch(/border-t border-border\/50[\s\S]{0,40}data-testid=\{`prescription-row-/);
    // 기능 동선(행 삭제 버튼) 보존.
    expect(src).toContain('aria-label="처방 항목 삭제"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 — 진료일/담당의 한 줄 + 담당의 슬림 + 테두리 정리
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5 진료일/담당의 한 줄 + 담당의 슬림', () => {
  test('한 줄 배치(sm:flex-row items-end) + 진료일 자연폭 + 담당의 슬림(~7.5rem)', () => {
    const src = PANEL();
    // 진료일|담당의 한 줄(sm:flex-row sm:items-end).
    expect(src).toMatch(/flex flex-col sm:flex-row sm:items-end[\s\S]{0,80}data-testid="chart-date-doctor-row"/);
    // 진료일 자연폭(flex-1 제거).
    expect(src).toContain('sm:flex-none min-w-0 text-left');
    // 진료일 입력칸 테두리 제거.
    expect(src).toMatch(/className="h-9 text-sm text-left border-0[\s\S]{0,180}data-testid="medical-chart-date"/);
    // 담당의 select 슬림 폭(~7.5rem) — 한글 5자 내외.
    expect(src).toContain('sm:max-w-[7.5rem]');
    expect(src).toContain('data-testid="medical-chart-signing-doctor"');
    // 평상시 border-0(미선택시 rose border 경고만).
    expect(src).toMatch(/!formSigningDoctorId[\s\S]{0,80}border border-rose-300/);
    expect(src).toMatch(/: 'border-0'/);
    // 회귀 가드: 진료의 선택칸 자체(저장경로) 보존.
    expect(src).toContain('value={formSigningDoctorId}');
    expect(src).toContain('진료의를 선택해야 저장할 수 있습니다');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 — 회귀 가드: 데이터/저장 + 2COL/DATE-DIAG 기구현 배치
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6 회귀 가드', () => {
  test('2COL 2단 grid row + 저장 동선 무변경', () => {
    const src = PANEL();
    // row2 진단명|처방내역 2단 + row3 치료사차트|치료메모 2단 유지.
    expect(src).toContain('data-testid="chart-dx-rx-row"');
    expect(src).toContain('data-testid="chart-tx-treatmemo-row"');
    // 저장 버튼/경로 유지.
    expect(src).toContain('data-testid="medical-chart-save-btn"');
    // 처방 저장 상태(formRx) 경로 무변경.
    expect(src).toContain('data-testid="prescription-items-table"');
  });

  test('진단명 저장경로(formDx) + 주상병 승격/삭제 기능 보존', () => {
    const src = PICKER();
    expect(src).toContain('data-testid="dx-chip-make-primary"');
    expect(src).toContain('data-testid="dx-chip-remove"');
    expect(src).toContain('handleMakePrimary(idx)');
    expect(src).toContain('handleRemove(idx)');
    // CLS 안정화(항상 렌더 + min-h reserve) 회귀 가드.
    expect(src).toMatch(/min-h-\[2\.25rem\][\s\S]{0,80}data-testid="dx-selected-chips"/);
  });
});
