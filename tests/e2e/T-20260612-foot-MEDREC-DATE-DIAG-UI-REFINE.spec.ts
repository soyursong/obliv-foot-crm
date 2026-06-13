/**
 * E2E spec — T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE
 * 진료기록 패널(MedicalChartPanel + DiagnosisFolderPicker) UI 정밀 수정 9항목.
 * reporter: 문지은 대표원장 (C0ATE5P6JTH). 2COL-LABEL-CLEANUP(PR#1) dev-preview 위에 fold.
 *
 * 항목:
 *   ① 진료일 — 좌측정렬 + 달력 아이콘(type=date) 인풋
 *   ② 담당의 — 우측정렬 + 드롭다운(select, 의사 role=clinicDoctors)
 *   ③ 부상병 칩에 '주상병' 텍스트 우측 표출 제거(승격은 아이콘으로 보존) — 부상병 내용만
 *   ④ 상병코드만 bold, 상병명 normal (renderDxLabel — ICD/KCD 코드 패턴 분리)
 *   ⑤ '임상경과' 소헤더 추가
 *   ⑥ '//단축어 입력 시 자동완성' 설명 텍스트 제거 (// 트리거 기능은 유지)
 *   ⑦ 의료진 전용메모 — 안내문구 전부 제거 → '의료진 전용메모' 소헤더만 (2COL-LABEL AC6 supersede)
 *   ⑧ 치료사차트|치료메모 2단 구성 (2COL-LABEL 기구현 — 회귀 가드)
 *   ⑨ 치료사 섹션(치료사차트·치료메모) 내용 없을 때 compact (고정 8rem 제거)
 *   + 치료메모 렌더 회귀 가드(선행 배포 regression 의심 — 2단에서 정상 렌더 확인)
 *
 * 스타일: 형제 티켓(MEDREC-CLINICAL-SAVE-UICLEANUP)과 동일 — 정본 소스 정적 가드(auth/DB 비의존, 결정론적).
 *   이 패널은 6/9~6/12 연속변형 핫스팟이라 시드/권한 의존 라이브 시나리오는 flaky →
 *   presence/absence 가드로 AC를 결정론적으로 고정. 라이브 실화면 최종판정은 supervisor QA.
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
// ① 진료일 — 좌측정렬 + 달력 아이콘 date input
// ─────────────────────────────────────────────────────────────────────────────
test.describe('① 진료일 — 좌측정렬 date input', () => {
  test('진료일은 type="date"(달력 아이콘) + 좌측정렬', () => {
    const src = PANEL();
    // date input(네이티브 달력 아이콘/피커) 유지.
    expect(src).toContain('data-testid="medical-chart-date"');
    expect(src).toContain('type="date"');
    // 좌측정렬 명시(input className 에 text-left).
    expect(src).toMatch(/className="h-9 text-sm text-left[\s\S]{0,160}data-testid="medical-chart-date"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 담당의 — 우측정렬 + 드롭다운(select, 의사 role)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('② 담당의 — 우측정렬 드롭다운', () => {
  test('담당의 블록은 우측정렬(items-end/text-right) + select + clinicDoctors(의사) 옵션', () => {
    const src = PANEL();
    expect(src).toMatch(/sm:items-end"[\s\S]{0,40}data-testid="signing-doctor-select-block"/);
    expect(src).toMatch(/sm:text-right">[\s\S]{0,40}담당 의사/);
    // 드롭다운 + 의사 role(clinicDoctors) 옵션.
    expect(src).toMatch(/data-testid="medical-chart-signing-doctor"/);
    expect(src).toMatch(/clinicDoctors\.map/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 부상병 칩 — '주상병' 텍스트 미표출 (승격은 아이콘으로 보존)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('③ 부상병 칩 주상병 텍스트 제거', () => {
  test('make-primary 버튼은 텍스트 "주상병" 미노출 → 아이콘(ChevronUp)', () => {
    const src = PICKER();
    // 승격 버튼 자체(기능)는 보존.
    expect(src).toContain('data-testid="dx-chip-make-primary"');
    expect(src).toContain('handleMakePrimary(idx)');
    // 버튼 자식이 텍스트 '주상병'이 아니라 ChevronUp 아이콘.
    expect(src).toMatch(/data-testid="dx-chip-make-primary"[\s\S]{0,200}<ChevronUp/);
    // 버튼 라벨로서의 텍스트 노드 '주상병' 미존재(접근성 라벨 aria-label/title 은 텍스트 노드 아님 — 허용).
    expect(src).not.toMatch(/>\s*주상병\s*<\/button>/);
    expect(src).toContain("import { ChevronDown, ChevronUp,");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 상병코드 bold · 상병명 normal
//   T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE AC-2 supersede: 진단명 칩(inline renderDxLabel)
//   → 헤더없는 테이블뷰 [주/부 | 코드 | 상병명]. 코드/이름이 별도 컬럼으로 분리(splitDxLabel)되며,
//   '코드 bold' 의도는 코드 <td> 의 font-bold 로 보존. 이전 renderDxLabel 인라인 분리는 폐지.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('④ 상병코드 bold (테이블뷰 컬럼)', () => {
  test('splitDxLabel: ICD/KCD 코드 토큰 분리 + 코드 컬럼 font-bold, 상병명 컬럼 normal', () => {
    const src = PICKER();
    // 코드/이름 분리 헬퍼(테이블 컬럼용).
    expect(src).toContain('function splitDxLabel(');
    expect(src).toMatch(/code: m\[1\], name: m\[2\]/);
    // 선택 상병 테이블 — [주/부 | 코드 | 상병명] 헤더없는 테이블뷰(AC-2).
    expect(src).toContain('data-testid="dx-selected-table"');
    expect(src).toContain('const { code, name } = splitDxLabel(label);');
    // 코드 컬럼 bold(④ 의도 보존), 상병명 컬럼은 일반.
    expect(src).toMatch(/font-bold font-mono[\s\S]{0,60}\{code\}/);
    expect(src).toMatch(/block truncate[\s\S]{0,40}\{name\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤⑥ 임상경과 소헤더 + //단축어 설명 제거(기능 유지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('⑤⑥ 임상경과 헤더 + 단축어 설명 제거', () => {
  test('⑤ 임상경과 소헤더(h4) 존재', () => {
    const src = PANEL();
    expect(src).toContain('<h4 className="text-xs font-medium text-gray-700">임상경과</h4>');
  });
  test('⑥ "//단축어 입력 시 자동완성" 설명 텍스트 제거 + 기능(// 트리거 핸들러·팝오버) 유지', () => {
    const src = PANEL();
    expect(src).not.toContain('//단축어 입력 시 자동완성');
    // 기능 보존: // 트리거 팝오버·핸들러.
    expect(src).toContain('data-testid="phrase-autocomplete-popover"');
    expect(src).toContain('handleClinicalChange');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 의료진 전용메모 — 안내문구 제거 → 소헤더만 (2COL-LABEL AC6 supersede)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('⑦ 의료진 전용메모 소헤더만', () => {
  test('안내문구 제거 + "의료진 전용메모" 소헤더 + isDirector 게이트 유지', () => {
    const src = PANEL();
    expect(src).not.toContain('의료진 전용 메모입니다. 타 스태프에게 노출되지 않습니다');
    expect(src).not.toContain('data-testid="doctor-memo-notice"');
    expect(src).toContain('data-testid="doctor-memo-header"');
    expect(src).toContain('>의료진 전용메모</h4>');
    // 노출제한(isDirector) + 입력 필드 보존.
    expect(src).toMatch(/\{isDirector \?\s*\([\s\S]*?data-testid="doctor-memo-section"/);
    expect(src).toContain('data-testid="doctor-memo-input"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ 치료사차트|치료메모 2단 (회귀 가드) + 치료메모 렌더 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('⑧ 치료사차트|치료메모 2단 + 치료메모 렌더', () => {
  test('치료사차트(좌)|치료메모(우) 2단 row + 치료메모 뷰어 정상 렌더', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="chart-tx-treatmemo-row"');
    expect(src).toMatch(/flex flex-col sm:flex-row[\s\S]{0,40}data-testid="chart-tx-treatmemo-row"/);
    // 치료메모 영역 렌더(이력 + 빈상태) — regression(사라짐) 가드.
    expect(src).toContain('data-testid="treat-memo-in-chart-section"');
    expect(src).toContain('data-testid="treat-memo-empty"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ 치료사 섹션 빈값 compact
// ─────────────────────────────────────────────────────────────────────────────
test.describe('⑨ 치료사 섹션 빈값 compact', () => {
  test('치료사차트: 내용 없으면 min-h-0(compact), 있으면 min-h-[8rem]', () => {
    const src = PANEL();
    expect(src).toContain("formTx ? 'min-h-[8rem]' : 'min-h-0'");
    expect(src).toContain('rows={formTx ? 7 : 2}');
  });
  test('치료메모 빈상태: 고정 8rem 제거(compact padding)', () => {
    const src = PANEL();
    // 빈상태 div 가 더 이상 min-h-[8rem] 고정/centered 가 아님.
    expect(src).not.toMatch(/data-testid="treat-memo-empty"[\s\S]{0,160}min-h-\[8rem\]/);
    expect(src).toMatch(/border border-dashed p-2[\s\S]{0,80}data-testid="treat-memo-empty"/);
  });
});
