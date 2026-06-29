import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260615-foot-RESV-DWELL-LOADING-STUCK — 예약관리 무한 로딩(스피너 고착) 회귀 가드
 * MQ: MSG-20260615-135456-vwdh (NEW-TASK, planner, P1/hotfix).
 * reporter: 현장(13:46:53). 증상: 예약관리 '불러오는 중…' 스피너 영구 고착 → 그리드 미표시.
 *
 * 진단 결론 (코드증거 확정):
 *   - 6cdce9d(REFIX-8 레이아웃)는 fetch/loading 경로 무접촉 → 회귀 원인 아님(상관은 우연).
 *   - 실제 RC = Reservations.tsx fetchWeek 에 예외 경계(try/catch/finally) 부재.
 *     supabase await reject(네트워크 단절·PostgREST throw) 또는 stripSimulationRows throw 시
 *     setLoading(false) 미도달 → loading=true 영구 + rows 빈 채 → '불러오는 중…' 영구 고착.
 *     field-soak 중 일시적 fetch 실패가 잠복 결함을 영구화(자가복구 불가).
 *   - 수정: fetchWeek 전구간 try/catch/finally — finally setLoading(false)로 무조건 로딩 해제 보장.
 *     (REFIX-8 레이아웃 COMPLEMENT, 레이아웃/동선 코드 무변경, DB 무변경)
 *
 * 본 spec = source-integrity 회귀 가드(거대 인라인 Reservations.tsx 관례).
 *   실 렌더 검증은 supervisor field-soak(갤탭 실기기).
 */

const SRC = path.resolve('src/pages/Reservations.tsx');

function readSrc(): string {
  return fs.readFileSync(SRC, 'utf-8');
}

/** fetchWeek 함수 본문 슬라이스 추출 (useCallback 선언 ~ 의존성 배열 닫힘). */
function fetchWeekSlice(src: string): string {
  const start = src.indexOf('const fetchWeek = useCallback(async () => {');
  expect(start, 'fetchWeek useCallback 선언이 존재해야 함').toBeGreaterThan(-1);
  const end = src.indexOf('}, [clinic, weekDays, viewMode, selectedDay]);', start);
  expect(end, 'fetchWeek 의존성 배열 닫힘이 존재해야 함').toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('T-20260615-foot-RESV-DWELL-LOADING-STUCK', () => {
  test('RC-1: fetchWeek 가 예외 경계(try/catch/finally)를 가진다', () => {
    const slice = fetchWeekSlice(readSrc());
    expect(slice, 'fetchWeek 에 try 블록이 있어야 함').toContain('try {');
    expect(slice, 'fetchWeek 에 catch 블록이 있어야 함').toMatch(/catch\s*\(\s*e\s*\)\s*\{/);
    expect(slice, 'fetchWeek 에 finally 블록이 있어야 함').toMatch(/finally\s*\{/);
  });

  test('RC-2: finally 가 setLoading(false) 로 로딩을 무조건 해제한다', () => {
    const slice = fetchWeekSlice(readSrc());
    const finallyIdx = slice.indexOf('finally');
    expect(finallyIdx).toBeGreaterThan(-1);
    const finallyBlock = slice.slice(finallyIdx);
    expect(finallyBlock, 'finally 안에서 setLoading(false) 호출 — 어떤 경로에서도 스피너 해제 보장')
      .toContain('setLoading(false)');
  });

  test('RC-3: 예외 시 사용자에게 실패를 알린다(무성 고착 금지)', () => {
    const slice = fetchWeekSlice(readSrc());
    const catchIdx = slice.search(/catch\s*\(\s*e\s*\)\s*\{/);
    expect(catchIdx).toBeGreaterThan(-1);
    const finallyIdx = slice.indexOf('finally', catchIdx);
    const catchBlock = slice.slice(catchIdx, finallyIdx > -1 ? finallyIdx : undefined);
    expect(catchBlock, 'catch 에서 toast.error 로 재시도 유도').toContain('toast.error');
  });

  test('GUARD: 로딩 스피너 게이트(loading && rows.length===0)가 유지된다', () => {
    const src = readSrc();
    expect(src, '그리드 로딩 게이트 — 본 수정의 대상 조건').toContain('loading && rows.length === 0');
    expect(src, "'불러오는 중…' 스피너 텍스트 유지").toContain('불러오는 중');
  });

  test('NON-REGRESSION: REFIX-8 레이아웃(AC1·AC8) 코드 무변경 입증', () => {
    const src = readSrc();
    // COMPLEMENT 보증: 본 핫픽스는 fetchWeek 만 손대고 레이아웃/동선은 건드리지 않음.
    expect(src, 'AC8 인앱 차트 통일(window.open 제거) 유지').toContain('handleResvOpenChart(resvAsCheckIn(r))');
    // T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 경과분석 토글(progress-filter-btn)은 예약관리에서 제거되어 치료테이블 [경과분석] 탭으로 이관.
    //   본 핫픽스(fetchWeek try/catch/finally)와 무관 — 레이아웃 무변경 입증 앵커를 '일간/주간 뷰 토글'로 대체.
    expect(src, '일간/주간 뷰 토글 레이아웃 유지').toContain("setViewMode('week')");
    expect(src, '경과분석 토글은 예약관리에서 제거됨(치료테이블로 이관)').not.toContain('progress-filter-btn');
  });
});
