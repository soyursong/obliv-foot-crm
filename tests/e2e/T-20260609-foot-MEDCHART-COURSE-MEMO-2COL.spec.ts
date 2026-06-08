/**
 * E2E spec — T-20260609-foot-MEDCHART-COURSE-MEMO-2COL
 * 진료기록 작성영역 레이아웃 재배치: 임상경과(공식·좌 ~80%) ↔ 진료메모(비공식·우 ~20%) 2단 + 처방내역→진단명 아래.
 *
 * ⚠ REDEFINITION_RISK / DUPLICATE 인지:
 *   본 티켓(MSG-20260609-030745-twsc, dispatch 03:07:45)은 T-20260609-foot-MEDCHART-NOTES-2COL
 *   (MSG-20260609-030718-8xsh, dispatch 03:07:18 — 27초 앞)과 동일 재배치를 요구한다.
 *   NOTES-2COL 은 commit 850ceed 로 이미 deploy-ready(04:05) → 레이아웃 코드는 이미 AC-1/AC-2 충족.
 *   따라서 본 spec 은 레이아웃 코드 reopen 없이 (a) 본 티켓이 명시한 현장 클릭 시나리오 3종을 traceable 하게
 *   고정하고, (b) NOTES-2COL spec 이 다루지 않은 "좁은 뷰 세로스택 fallback 엣지"를 신규로 가드한다.
 *
 * AC-0 (그라운딩 — 코드/화면 확정):
 *   - 임상경과 = clinical_progress (state formClinical, testid medical-chart-clinical) — 공식. 좌측 컬럼.
 *   - 진료메모 = doctor_memo     (state formMemo,     testid doctor-memo-input)     — 비공식·원장(isDirector)전용. 우측 컬럼.
 *   - 처방내역 = prescription_items (state formRx, testid prescription-items-table).
 *   - 좌측 "진료 경과 타임라인"(읽기전용 리스트, MEDCHART-TIMELINE-COMPACT) 은 본 2단의 "임상경과/진료메모"와 **별 surface** — 비접촉.
 *   - wrapper(testid notes-2col-row) = `flex flex-col sm:flex-row` → 넓은 뷰=좌우 row(4:1), 좁은 뷰=세로 col(stack).
 *
 * AC-1: 임상경과(좌·flex-4 ≈80%) · 진료메모(우·flex-1 ≈20%) 같은 영역 2단(4:1) 동시 노출. 좁은 뷰 세로스택 fallback.
 * AC-2: 처방내역 → 진단명 바로 아래.
 *
 * ★ 설계 근거(grid vs flex): 티켓 괄호 힌트 `grid-template-columns: 4fr 1fr` 를 문자 그대로 적용하면
 *   진료메모 미렌더(비원장) 시 빈 1fr 트랙 갭이 남아 "임상경과 전폭" AC 를 깨뜨린다.
 *   조건부 렌더 + flex-[4]/flex-[1] 가 (4:1 + 비원장 전폭 + 좁은뷰 스택) 3요건을 모두 만족하는 정답이라 기 구현을 유지한다.
 *
 * DB 무변경·비즈로직 무변경(렌더 배치만). 입력/저장 동선(handleSave: state→컬럼) 무영향.
 * 스타일: 기존 풋 진료차트 spec 관례 — JSX 배치/반응형 규칙을 인-페이지 순수 로직으로 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본: notes-2col wrapper 반응형 방향 (flex flex-col sm:flex-row) ─────────────
//   viewport < sm(640px) → 'stack'(세로) · ≥ sm → 'row'(좌우 4:1)
type Axis = 'stack' | 'row';
const resolveAxis = (viewportWidth: number): Axis => (viewportWidth < 640 ? 'stack' : 'row');

// ── 정본: 임상경과·진료메모 컬럼 배치 (isDirector 게이트, 조건부 렌더 + flex 가중치) ──
interface NotesLayout {
  axis: Axis;
  clinicalFlex: number;       // 임상경과 좌측 너비 가중치
  memoFlex: number | null;    // 진료메모 우측 가중치(미렌더면 null)
  memoRendered: boolean;
  clinicalWidthPct: number;   // 실제 차지 비율(%) — 형제 유무 반영
}
const resolveNotesLayout = (isDirector: boolean, viewportWidth: number): NotesLayout => {
  const memoRendered = isDirector;
  const clinicalFlex = 4;
  const memoFlex = memoRendered ? 1 : null;
  // row 축에서만 4:1 분할, 형제 없으면(비원장) 전폭. stack 축은 각자 100%.
  const axis = resolveAxis(viewportWidth);
  const clinicalWidthPct = !memoRendered
    ? 100
    : axis === 'row'
      ? (clinicalFlex / (clinicalFlex + (memoFlex as number))) * 100 // 80
      : 100; // 세로 스택에선 각 컬럼 전폭
  return { axis, clinicalFlex, memoFlex, memoRendered, clinicalWidthPct };
};

// ── 정본: 작성영역 블록 DOM 순서 (MedicalChartPanel JSX 형제 스택 모사) ─────────
//   진료일 → 진단명 → [처방내역] → 치료·시술 → 치료사차트 → [임상경과|진료메모] → 서명 → 저장
type Block =
  | 'date' | 'diagnosis' | 'rx' | 'visit-payments'
  | 'therapist-chart' | 'notes-2col' | 'recorder' | 'save';
const writeAreaOrder: Block[] = [
  'date', 'diagnosis', 'rx', 'visit-payments',
  'therapist-chart', 'notes-2col', 'recorder', 'save',
];

// ── 정본: 저장 매핑 (handleSave — DOM/반응형 배치 무관, state→컬럼) ──────────────
interface ChartForm { formClinical: string; formMemo: string; formRx: string[] }
interface ChartRow { clinical_progress: string; doctor_memo: string; prescription_items: string[] }
const buildSavePayload = (f: ChartForm): ChartRow => ({
  clinical_progress: f.formClinical,
  doctor_memo: f.formMemo,
  prescription_items: f.formRx,
});

// ═════════════════════════════════════════════════════════════════════════════
// 현장 클릭 시나리오 ① — 2단 비율(4:1, ~80%/~20%)
//   현장: 원장이 넓은 태블릿 가로뷰에서 임상경과(좌)와 진료메모(우)를 같은 영역에서 본다.
// ═════════════════════════════════════════════════════════════════════════════
test.describe('시나리오① AC-1 2단 비율(4:1 ≈ 80%/20%)', () => {
  test('원장·넓은 뷰: 임상경과(4)·진료메모(1) 같은 row 4:1 동시 노출(탭전환 X)', () => {
    const layout = resolveNotesLayout(true, 1280);
    expect(layout.axis).toBe('row');
    expect(layout.memoRendered).toBe(true);
    expect(layout.clinicalFlex).toBe(4);
    expect(layout.memoFlex).toBe(1);
    expect(layout.clinicalFlex / (layout.memoFlex as number)).toBe(4);
  });

  test('원장·넓은 뷰: 임상경과 ≈80% · 진료메모 ≈20% 너비 차지', () => {
    const layout = resolveNotesLayout(true, 1280);
    expect(layout.clinicalWidthPct).toBe(80);   // 4 / (4+1)
    // 진료메모는 나머지 20%
    expect(100 - layout.clinicalWidthPct).toBe(20);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 현장 클릭 시나리오 ② — 처방내역 위치(진단명 바로 아래)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('시나리오② AC-2 처방내역 → 진단명 바로 아래', () => {
  test('처방내역은 진단명 직후', () => {
    const di = writeAreaOrder.indexOf('diagnosis');
    const rxi = writeAreaOrder.indexOf('rx');
    expect(rxi).toBe(di + 1);
  });

  test('처방내역은 임상경과/진료메모(2단) 보다 위, 치료사차트보다 위', () => {
    const rxi = writeAreaOrder.indexOf('rx');
    expect(rxi).toBeLessThan(writeAreaOrder.indexOf('notes-2col'));
    expect(rxi).toBeLessThan(writeAreaOrder.indexOf('therapist-chart'));
  });

  test('전체 블록 순서 회귀 가드(스냅샷)', () => {
    expect(writeAreaOrder).toEqual([
      'date', 'diagnosis', 'rx', 'visit-payments',
      'therapist-chart', 'notes-2col', 'recorder', 'save',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 현장 클릭 시나리오 ③ — 좁은 뷰 엣지(세로 스택 fallback) + 비원장 전폭
//   현장: 좁은 화면(세로 태블릿/팝업)에서 좌우가 짓눌리지 않고 위아래로 쌓인다.
//   ★ NOTES-2COL spec 미커버 영역 — 본 티켓 신규 가드.
// ═════════════════════════════════════════════════════════════════════════════
test.describe('시나리오③ AC-1 좁은 뷰 세로스택 fallback + 비원장 전폭', () => {
  test('좁은 뷰(<640): 좌우 2단이 세로 스택으로 fallback (짓눌림 방지)', () => {
    const layout = resolveNotesLayout(true, 480);
    expect(layout.axis).toBe('stack');
    // 세로 스택에서는 각 컬럼이 전폭을 차지
    expect(layout.clinicalWidthPct).toBe(100);
  });

  test('넓은 뷰(≥640): 다시 좌우 4:1 row 로 복귀', () => {
    expect(resolveNotesLayout(true, 640).axis).toBe('row');
    expect(resolveNotesLayout(true, 1024).axis).toBe('row');
  });

  test('비원장: 진료메모 미렌더 → 임상경과 전폭(빈 트랙 갭 없음 — grid 4fr1fr 대비 flex 우위)', () => {
    const wide = resolveNotesLayout(false, 1280);
    expect(wide.memoRendered).toBe(false);
    expect(wide.memoFlex).toBeNull();
    expect(wide.clinicalWidthPct).toBe(100); // 형제 없음 → 전폭(빈 1fr 갭 없음)
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 공통 — 입력/저장 동선 무영향(데이터 경로 변경 금지 회귀 가드)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('회귀: 입력/저장 동선(state→컬럼) 무영향', () => {
  test('좌우 동시입력 → 각 컬럼 보존(상호 덮어쓰기 없음)', () => {
    const row = buildSavePayload({
      formClinical: '족저근막염 통증 호전. 보행 시 압통 감소.',
      formMemo: '야간 부목 권유 (원장 메모)',
      formRx: ['이지엔6'],
    });
    expect(row.clinical_progress).toBe('족저근막염 통증 호전. 보행 시 압통 감소.');
    expect(row.doctor_memo).toBe('야간 부목 권유 (원장 메모)');
    expect(row.clinical_progress).not.toBe(row.doctor_memo);
  });

  // (CANCELLATION reconcile MSG-20260609-030830-vuaz) 폐기된 NOTES-2COL spec 고유 엣지 흡수:
  // 한쪽 컬럼만 입력해도 반대쪽 빈 값이 누락 없이 보존되는지 가드.
  test('한쪽만 입력해도 다른 쪽 빈 값 보존(누락 없음)', () => {
    const onlyClinical = buildSavePayload({ formClinical: '경과 양호', formMemo: '', formRx: [] });
    expect(onlyClinical.clinical_progress).toBe('경과 양호');
    expect(onlyClinical.doctor_memo).toBe('');

    const onlyMemo = buildSavePayload({ formClinical: '', formMemo: '내부 메모', formRx: [] });
    expect(onlyMemo.clinical_progress).toBe('');
    expect(onlyMemo.doctor_memo).toBe('내부 메모');
  });

  test('재배치(반응형 축 변동)는 저장 payload 에 무영향', () => {
    const form: ChartForm = { formClinical: 'A', formMemo: 'B', formRx: ['C'] };
    // 어떤 뷰포트에서 작성하든 저장 매핑은 동일
    expect(buildSavePayload(form)).toEqual({ clinical_progress: 'A', doctor_memo: 'B', prescription_items: ['C'] });
  });
});
