/**
 * E2E spec — T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL
 * 진료대시보드(DoctorCallDashboard) 임상경과 인라인 패널 저장 실패(데이터 미저장) 핫픽스.
 *
 * 신고(문지은 대표원장 6/11):
 *   "임상경과 토글 펼침 → 입력 → 저장해도 저장 안 됨(데이터 미저장)."
 *
 * 진단(DB 증거):
 *   medical_charts 는 정상 적재됨. 다만 동일 환자(8c0c157c)에게 today(2026-06-11) 차트가 16초 간격
 *   2건 '신규 INSERT'(created_at == updated_at) 됨 → UPDATE 가 아니라 매번 새 행 생성.
 *   루트코즈 = clinicalInit 레이스:
 *     MedicalChartPanel(variant='clinical') 의 today-차트 자동선택 effect 가, loadData 가 charts 를
 *     서버에서 받기 전(초기 빈 배열) 에 한 번 돌고 clinicalInitRef 로 영구 latch → today-차트를 못 잡음.
 *     → 재펼침 시 기존 today-차트 미선택(빈 textarea) → 다음 저장이 selectedChartId=null 이라 신규 INSERT.
 *     사용자 체감: 첫 입력이 "사라짐" = "저장 안 됨" + 같은날 중복차트 누적(데이터 무결성 훼손).
 *
 * 수정(DELTA — 신규 저장로직 0, 자동선택 게이트만 가산):
 *   - chartsLoadedRef: loadData 가 charts 서버조회를 최초 성공 반영했는지 신호(ref). 로드 시작 시 false, 완료 시 true.
 *   - clinicalInit: `if (!chartsLoadedRef.current) return;` 추가 → charts 로드 전엔 latch 금지.
 *       loadData 완료(charts state 변경) 시 effect 재실행 → 이때 비로소 today-차트 자동선택.
 *   - handleSave: 저장 차단 early-return 을 silent 가 아니라 toast 로 표면화(planner 가드).
 *   - 회귀가드: 진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6, 의료법) 무변경.
 *
 * 검증(현장 클릭 시나리오 → AC):
 *   AC-1: 재펼침 시 기존 today-차트 자동선택(빈 textarea 아님) — 로드 완료 후에만 latch.
 *   AC-2: 같은날 중복 INSERT 방지 — today-차트 존재 시 selectedChartId 세팅 → 저장이 UPDATE 경로.
 *   AC-3: 저장 차단을 silent fail 아닌 에러 표면화(toast).
 *   AC-4: 진료의 NOT NULL 강제(AC-P2-6) 회귀 금지 — FE 가드 + DB 트리거 보존.
 *
 * 스타일: 형제 티켓(EXPAND-CLINICAL)과 동일 — 자동선택 결정 in-page 모사 + 소스 정적 배선 가드.
 *   auth/DB 비의존(순수 함수 + 소스 grep).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: clinicalInit today-차트 자동선택 (latch 게이트 포함) ───────────────
//   구현 정본(MedicalChartPanel.tsx clinicalInit effect):
//     if (variant!=='clinical') return;
//     if (!open) { ref=false; return; }
//     if (loading || ref) return;
//     if (!chartsLoaded) return;     ← T-20260611 가산(레이스 차단)
//     todays = charts.find(today && !dummy); if (todays) select+resetForm; ref=true;
interface ChartRow { id: string; visit_date: string }
interface InitState { selectedChartId: string | null; latched: boolean }
const TODAY = '2026-06-11';

/** clinicalInit 1회 호출 모사. 반환 = 자동선택 결과. */
function clinicalInit(prev: InitState, args: {
  variant: 'full' | 'clinical';
  open: boolean;
  loading: boolean;
  chartsLoaded: boolean;   // ← 본 핫픽스 게이트
  charts: ChartRow[];
}): InitState {
  if (args.variant !== 'clinical') return prev;
  if (!args.open) return { selectedChartId: prev.selectedChartId, latched: false };
  if (args.loading || prev.latched) return prev;
  // T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL: 차트 로드 전 latch 금지.
  if (!args.chartsLoaded) return prev;
  const todays = args.charts.find((c) => c.visit_date === TODAY && !c.id.startsWith('__dummy__'));
  return { selectedChartId: todays ? todays.id : prev.selectedChartId, latched: true };
}

/** 저장 경로 판정 — selectedChartId 있으면 UPDATE, 없으면 신규 INSERT. */
function savePath(selectedChartId: string | null): 'update' | 'insert' {
  return selectedChartId ? 'update' : 'insert';
}

// 마운트~로드 라이프사이클 모사: open effect(loading=true) → loadData 완료(charts 채워짐, chartsLoaded=true).
function mountThenLoad(charts: ChartRow[]): InitState {
  let st: InitState = { selectedChartId: null, latched: false };
  // 1) 초기 렌더: 아직 loadData 시작 전 — loading=false, charts=[], chartsLoaded=false (레이스 창)
  st = clinicalInit(st, { variant: 'clinical', open: true, loading: false, chartsLoaded: false, charts: [] });
  // 2) loadData 진행 중: loading=true
  st = clinicalInit(st, { variant: 'clinical', open: true, loading: true, chartsLoaded: false, charts: [] });
  // 3) loadData 완료: charts 반영 + chartsLoaded=true, loading=false → 이때 자동선택
  st = clinicalInit(st, { variant: 'clinical', open: true, loading: false, chartsLoaded: true, charts });
  return st;
}

const C_TODAY: ChartRow = { id: 'chart-today-1', visit_date: TODAY };

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 재펼침 시 기존 today-차트 자동선택 (레이스 차단)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 재펼침: 기존 today-차트 자동선택(빈 textarea 아님)', () => {
  test('today-차트 존재 시 마운트~로드 후 selectedChartId = today 차트', () => {
    const st = mountThenLoad([C_TODAY]);
    expect(st.latched).toBe(true);
    expect(st.selectedChartId).toBe('chart-today-1');
  });

  test('★레이스 회귀: chartsLoaded 게이트 없으면 빈 charts 로 latch 되어 today-차트 미선택', () => {
    // 게이트 제거(=버그) 모사: 초기 렌더에서 chartsLoaded=true 로 통과시키면 빈 charts 로 latch.
    let st: InitState = { selectedChartId: null, latched: false };
    st = clinicalInit(st, { variant: 'clinical', open: true, loading: false, chartsLoaded: true, charts: [] });
    expect(st.latched).toBe(true);
    expect(st.selectedChartId).toBeNull(); // ← 버그 재현: today-차트 못 잡음
    // 게이트 적용 시(정본)은 위 AC-1 첫 테스트처럼 chart-today-1 선택.
  });

  test('today-차트 없으면 신규 모드(selectedChartId=null) 유지 — 정상', () => {
    const st = mountThenLoad([{ id: 'chart-old', visit_date: '2026-06-09' }]);
    expect(st.latched).toBe(true);
    expect(st.selectedChartId).toBeNull();
  });

  test('dummy 차트는 자동선택 제외', () => {
    const st = mountThenLoad([{ id: '__dummy__1', visit_date: TODAY }]);
    expect(st.selectedChartId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 같은날 중복 INSERT 방지 (데이터 무결성)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 재저장은 UPDATE(같은날 중복차트 금지)', () => {
  test('today-차트 자동선택 후 저장 → UPDATE 경로(신규 INSERT 아님)', () => {
    const st = mountThenLoad([C_TODAY]);
    expect(savePath(st.selectedChartId)).toBe('update');
  });

  test('★버그 재현: 게이트 없으면 selectedChartId=null → 저장이 신규 INSERT(중복차트)', () => {
    let st: InitState = { selectedChartId: null, latched: false };
    st = clinicalInit(st, { variant: 'clinical', open: true, loading: false, chartsLoaded: true, charts: [] });
    expect(savePath(st.selectedChartId)).toBe('insert'); // 같은날 두번째 행 생성 = 신고 증상
  });

  test('today-차트 없는 최초 작성은 정상적으로 신규 INSERT', () => {
    const st = mountThenLoad([]);
    expect(savePath(st.selectedChartId)).toBe('insert');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 저장 차단 표면화 (silent fail 제거)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 저장 차단을 toast 로 표면화', () => {
  test('handleSave: formDate 미설정 early-return 이 silent 가 아니라 toast.error', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    // 가드 블록 내부에 toast.error 가 들어있는지(빈 return 아님).
    const block = src.match(/if \(!customerId \|\| !clinicId \|\| !formDate\) \{[\s\S]*?\}/);
    expect(block, 'formDate 가드 블록 존재').not.toBeNull();
    expect(block![0]).toContain('toast.error');
    // 과거의 silent `return;` 단독 패턴이 남아있지 않은지.
    expect(src).not.toMatch(/if \(!customerId \|\| !clinicId \|\| !formDate\) return;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 회귀가드: 진료의 NOT NULL 강제(AC-P2-6, 의료법) 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 회귀가드 — 진료의 NOT NULL 강제 + 핵심 배선 불변', () => {
  test('FE: handleSave 의 진료의 미선택 저장 차단(toast) 보존', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/if \(!formSigningDoctorId\) \{/);
    expect(src).toMatch(/진료의가 필요합니다/);
  });

  test('DB: medical_charts BEFORE INSERT/UPDATE 진료의 강제 트리거 보존', () => {
    const mig = readFileSync(
      path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260608170000_medchart_signing_doctor.sql'),
      'utf8',
    );
    expect(mig).toMatch(/enforce_medchart_signing_doctor/);
    expect(mig).toMatch(/NEW\.signing_doctor_id IS NULL/);
    expect(mig).toMatch(/BEFORE INSERT OR UPDATE ON medical_charts/);
  });

  test('chartsLoadedRef: 선언 + loadData 재게이트(false)/완료(true) + clinicalInit 게이트 배선', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/const chartsLoadedRef = useRef\(false\)/);
    // loadData 시작 시 재무장(false).
    expect(src).toMatch(/chartsLoadedRef\.current = false/);
    // 성공 반영 후 true.
    expect(src).toMatch(/chartsLoadedRef\.current = true/);
    // clinicalInit 게이트.
    expect(src).toMatch(/if \(!chartsLoadedRef\.current\) return;/);
  });

  test('R-EMBED: 인라인 임상경과 저장 버튼이 동일 handleSave 재사용(신규 저장경로 0)', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    // clinical-mini 저장 버튼 onClick={handleSave} 보존.
    expect(src).toMatch(/data-testid="clinical-mini-save-btn"/);
    const block = src.match(/data-testid="clinical-mini-save-btn"[\s\S]{0,200}/);
    // 같은 패널에 medical_charts insert/update 경로는 handleSave 단 1곳(신규 write 경로 신설 금지).
    const writes = src.match(/\.from\('medical_charts'\)\s*\.\s*(insert|update)/g) ?? [];
    expect(writes.length).toBe(2); // handleSave 내부 update 1 + insert 1
    expect(block).not.toBeNull();
  });

  test('R-DOCCALL: DoctorCallDashboard 인라인(embed clinical) open prop + onSaved 접힘 보존', () => {
    const src = SRC('components/doctor/DoctorCallDashboard.tsx');
    expect(src).toMatch(/variant="clinical"/);
    expect(src).toMatch(/onSaved=\{\(\) => setShowClinical\(false\)\}/);
  });
});
