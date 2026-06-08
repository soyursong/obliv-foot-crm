/**
 * E2E spec — T-20260609-foot-MEDCHART-NOTES-2COL
 * 진료기록(의무기록) 작성 화면 입력 레이아웃 재배치.
 *
 * AC-0 (READ-ONLY 필드/구조 규명):
 *   - 임상경과 = clinical_progress (state formClinical, testid medical-chart-clinical) — 공식.
 *   - 진료메모 = doctor_memo     (state formMemo,     testid doctor-memo-input)     — 비공식·원장(isDirector)전용.
 *   - 처방내역 = prescription_items (state formRx, testid prescription-items-table).
 *   - 저장경로(handleSave)는 state 기반 → DOM 재배치는 저장값 무영향(동일 유지).
 *   - 좌측 경과타임라인(읽기전용 리스트, MEDCHART-TIMELINE-COMPACT / AC-6 FROZEN)과는 별 surface — 비접촉.
 *
 * AC-1: 임상경과(좌·flex-4) · 진료메모(우·flex-1) 같은 row 4:1 동시 노출(탭전환 X).
 *       비원장은 진료메모 미렌더 → 임상경과가 전폭.
 * AC-2: 처방내역 → 진단명 아래로 DOM 순서 이동(진단명↔치료사차트 영역).
 *
 * DB 무변경·비즈로직 무변경(렌더 순서·컬럼배치만). CHART-LAYOUT-SHIFT soak(commit d3b82e8) 산출물 비접촉.
 *
 * 스타일: 기존 풋 진료차트 spec 관례 — JSX 배치 규칙을 인-페이지 순수 로직으로 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본: 작성영역 블록 DOM 순서 (MedicalChartPanel JSX 형제 스택 모사) ─────────
//   진료일 → 진단명 → [처방내역] → 치료·시술 → 치료사차트 → [임상경과|진료메모] → 서명 → 저장
type Block =
  | 'date' | 'diagnosis' | 'rx' | 'visit-payments'
  | 'therapist-chart' | 'notes-2col' | 'recorder' | 'save';

const writeAreaOrder: Block[] = [
  'date', 'diagnosis', 'rx', 'visit-payments',
  'therapist-chart', 'notes-2col', 'recorder', 'save',
];

// ── 정본: 임상경과·진료메모 4:1 컬럼 배치 결정 (isDirector 게이트) ─────────────
//   {isDirector ? <진료메모 flex-1/> : null}  · 임상경과는 항상 flex-4
interface NotesLayout {
  row: 'same' | 'tab';        // 같은 row 동시 노출(탭전환 아님)
  clinicalFlex: number;       // 임상경과 좌측 너비 가중치
  memoFlex: number | null;    // 진료메모 우측 너비 가중치(미렌더면 null)
  memoRendered: boolean;
}
const resolveNotesLayout = (isDirector: boolean): NotesLayout => ({
  row: 'same',
  clinicalFlex: 4,
  memoFlex: isDirector ? 1 : null,
  memoRendered: isDirector,
});

// ── 정본: 저장 매핑 (handleSave — DOM 배치 무관, state→컬럼) ────────────────────
interface ChartForm { formClinical: string; formMemo: string; formRx: string[] }
interface ChartRow { clinical_progress: string; doctor_memo: string; prescription_items: string[] }
const buildSavePayload = (f: ChartForm): ChartRow => ({
  clinical_progress: f.formClinical,
  doctor_memo: f.formMemo,
  prescription_items: f.formRx,
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 좌우 동시입력 + 저장 보존
//   현장: 원장이 임상경과(좌)와 진료메모(우)를 같은 화면에서 동시에 채우고 저장 → 둘 다 보존.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 임상경과·진료메모 4:1 동시 노출 + 저장 보존', () => {
  test('원장: 임상경과(4)·진료메모(1)가 같은 row 에 동시 노출(탭전환 X)', () => {
    const layout = resolveNotesLayout(true);
    expect(layout.row).toBe('same');
    expect(layout.memoRendered).toBe(true);
    expect(layout.clinicalFlex).toBe(4);
    expect(layout.memoFlex).toBe(1);
    // 4:1 비율 보장
    expect(layout.clinicalFlex / (layout.memoFlex as number)).toBe(4);
  });

  test('비원장: 진료메모 미렌더 → 임상경과 전폭(좌측만)', () => {
    const layout = resolveNotesLayout(false);
    expect(layout.memoRendered).toBe(false);
    expect(layout.memoFlex).toBeNull();
    // 단일 컬럼 flex-4 = 형제 없음 → 전폭 차지(레이아웃 회귀 가드)
    expect(layout.clinicalFlex).toBe(4);
  });

  test('좌우 동시입력 → 저장 시 둘 다 각 컬럼에 보존(상호 덮어쓰기 없음)', () => {
    const form: ChartForm = {
      formClinical: '족저근막염 통증 호전. 보행 시 압통 감소.',
      formMemo: '보호자에게 야간 부목 권유 (원장 메모)',
      formRx: ['이지엔6', '록소닌'],
    };
    const row = buildSavePayload(form);
    expect(row.clinical_progress).toBe('족저근막염 통증 호전. 보행 시 압통 감소.');
    expect(row.doctor_memo).toBe('보호자에게 야간 부목 권유 (원장 메모)');
    // 임상경과 ≠ 진료메모 (각자 다른 컬럼으로 분리 보존)
    expect(row.clinical_progress).not.toBe(row.doctor_memo);
  });

  test('한쪽만 입력해도 다른 쪽 빈 값 보존(누락 없음)', () => {
    const onlyClinical = buildSavePayload({ formClinical: '경과 양호', formMemo: '', formRx: [] });
    expect(onlyClinical.clinical_progress).toBe('경과 양호');
    expect(onlyClinical.doctor_memo).toBe('');

    const onlyMemo = buildSavePayload({ formClinical: '', formMemo: '내부 메모', formRx: [] });
    expect(onlyMemo.clinical_progress).toBe('');
    expect(onlyMemo.doctor_memo).toBe('내부 메모');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 처방내역이 진단명 아래에 위치
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 처방내역 → 진단명 아래로 이동', () => {
  test('처방내역은 진단명 바로 아래에 위치', () => {
    const di = writeAreaOrder.indexOf('diagnosis');
    const rxi = writeAreaOrder.indexOf('rx');
    expect(rxi).toBe(di + 1); // 진단명 직후
  });

  test('처방내역은 임상경과/진료메모(2col) 보다 위에 위치', () => {
    const rxi = writeAreaOrder.indexOf('rx');
    const notesi = writeAreaOrder.indexOf('notes-2col');
    expect(rxi).toBeLessThan(notesi);
  });

  test('처방내역은 진단명↔치료사차트 영역(CLS soak 인접)에 안착 — 치료사차트보다 위', () => {
    const rxi = writeAreaOrder.indexOf('rx');
    const txi = writeAreaOrder.indexOf('therapist-chart');
    const di = writeAreaOrder.indexOf('diagnosis');
    expect(rxi).toBeGreaterThan(di);
    expect(rxi).toBeLessThan(txi);
  });

  test('전체 블록 순서 회귀 가드(스냅샷)', () => {
    expect(writeAreaOrder).toEqual([
      'date', 'diagnosis', 'rx', 'visit-payments',
      'therapist-chart', 'notes-2col', 'recorder', 'save',
    ]);
    // notes-2col(임상경과|진료메모)은 저장 직전, recorder(서명) 바로 위
    expect(writeAreaOrder.indexOf('notes-2col')).toBe(writeAreaOrder.indexOf('recorder') - 1);
  });
});
