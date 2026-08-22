/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-EXTRACT-FETCH-SILENT-SWALLOW-HARDEN
 *
 * 경과분석 추출 데이터 fetch 의 catch{} 무음삼킴 봉합.
 *   - fetch 에러(RLS 거부·컬럼부재·권한)는 supabase-js 에서 throw 가 아니라 { data:null, error } 로 반환 →
 *     기존 try/catch 는 이를 못 잡고 env 맵이 빈 채로 남아 .md 가 '데이터 없음(정상)'과 구분 불가.
 *   - 봉합: 각 쿼리에서 error 를 assertNoQueryError 로 명시 검사 → 섹션별 fetchErrors 기록 →
 *     buildProgressAnalysisMd 가 빈 섹션에 '⚠ 조회 실패: {원인}' 표기(빈 칸 금지).
 *   - clinic-mismatch(세션 clinic 컨텍스트 오설정 → .eq('clinic_id',…) silent 0-row): clinicId 공란 감지 시
 *     clinic-scoped 섹션(활성패키지·예약)에 '⚠ 조회 실패(clinic 컨텍스트 확인 필요)' 표기.
 *   - 회귀0: 정상 '데이터 없음'(쿼리 성공·0행)은 기존 '…없음' 문구 유지. 데이터 있는 경로 출력 불변.
 *
 * 대상(순수 함수 + fetch): buildProgressAnalysisMd / fetchProgressAnalysisData(가짜 supabase).
 *
 * AC(현장 시나리오 매핑):
 *   시나리오1(조회 실패, 에러 주입): fetch 에러 → 해당 섹션 '⚠ 조회 실패…' (빈 칸 아님).
 *   시나리오1-b(clinic-mismatch): clinicId 공란 → clinic-scoped 섹션 '⚠ 조회 실패(clinic 컨텍스트 확인 필요)'.
 *   시나리오2(정상 데이터 없음, 회귀): 쿼리 성공·0행 → 기존 '…없음' 유지('조회 실패' 아님).
 *   시나리오3(정상 데이터 있음, 회귀): 데이터 있는 경로 출력 무변 + fetchErrors 있어도 데이터 우선(회귀 가드).
 *
 * 실기기 다운로드/현장 클릭 = supervisor 갤탭 field-soak(browser_verify), CF phishing 해제 後.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildProgressAnalysisMd,
  fetchProgressAnalysisData,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';

const CUST_ID = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
const P: ProgressAnalysisPatient = { id: CUST_ID, name: '한지우', chart_number: 'C-3300' };
const TODAY = '2026-08-22';

/**
 * 가짜 supabase 클라이언트. 테이블별로 { data } 또는 { error } 를 반환하도록 설정.
 * 체이닝 메서드(select/eq/in/is/or/gte/neq/order)는 모두 self 반환, await 시 결과 resolve(thenable).
 */
type TableResult = { data?: unknown; error?: unknown };
function makeSupabase(tableResults: Record<string, TableResult>): SupabaseClient {
  const chainFor = (table: string) => {
    const result: TableResult = tableResults[table] ?? { data: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'eq', 'in', 'is', 'or', 'gte', 'neq', 'order']) {
      b[m] = () => b;
    }
    // thenable → await b === result
    b.then = (resolve: (v: TableResult) => unknown) => resolve(result);
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => chainFor(t) } as any as SupabaseClient;
}

// 전 테이블 성공(0행) 반환 — 정상 '데이터 없음' 베이스라인.
function allEmpty(): Record<string, TableResult> {
  return {};
}

test.describe('T-20260822 FETCH-SILENT-SWALLOW-HARDEN — 조회 실패 vs 데이터 없음 구분', () => {
  test('시나리오1: fetch 에러 주입 → 【8】【9】 등에 "⚠ 조회 실패" 표기(빈 칸 아님)', async () => {
    // packages / reservations / medical_charts 가 에러(error 반환) — 나머지는 성공(0행).
    const supabase = makeSupabase({
      packages: { error: { code: '42501', message: 'permission denied for table packages' } },
      reservations: { error: { code: '42P01', message: 'relation "reservations" does not exist' } },
      medical_charts: { error: { message: 'RLS policy blocked' } },
    });
    const env = await fetchProgressAnalysisData(supabase, 'clinic-1', [CUST_ID], TODAY);

    // fetchErrors 에 섹션 기록됨
    expect(env.fetchErrors?.has('activePkgs')).toBe(true);
    expect(env.fetchErrors?.has('reservations')).toBe(true);
    expect(env.fetchErrors?.has('chart')).toBe(true);
    // clinicId 정상 → clinicMismatch 아님(원인기반 표기)
    expect(env.fetchErrors?.get('activePkgs')?.clinicMismatch).toBeFalsy();

    const md = buildProgressAnalysisMd(P, env);
    // 【8】 활성 패키지 — 빈 칸/‘없음’ 대신 조회 실패 + 원인
    expect(md).toContain('# 【8】 활성 패키지');
    expect(md).toMatch(/⚠ 조회 실패:.*permission denied for table packages/);
    expect(md).not.toContain('_활성 패키지 없음_');
    // 【9】 예약내역 — 조회 실패 + 원인
    expect(md).toContain('# 【9】 예약내역');
    expect(md).toMatch(/⚠ 조회 실패:.*relation "reservations" does not exist/);
    expect(md).not.toContain('_예약내역 없음_');
    // 【5】 진료차트 발췌 — 조회 실패
    expect(md).toMatch(/⚠ 조회 실패:.*RLS policy blocked/);
  });

  test('시나리오1-b: clinicId 공란(clinic-mismatch) → clinic-scoped 섹션 "clinic 컨텍스트 확인 필요"', async () => {
    // 전 테이블 성공(0행)이지만 clinicId 공란 → clinic-scoped 는 silent 0-row 위험 → clinicMismatch 표기.
    const supabase = makeSupabase(allEmpty());
    const env = await fetchProgressAnalysisData(supabase, '', [CUST_ID], TODAY);

    expect(env.fetchErrors?.get('activePkgs')?.clinicMismatch).toBe(true);
    expect(env.fetchErrors?.get('reservations')?.clinicMismatch).toBe(true);
    // 비-clinic-scoped 섹션(치료메모)은 에러 없음 → 정상 '없음'
    expect(env.fetchErrors?.has('memos')).toBe(false);

    const md = buildProgressAnalysisMd(P, env);
    expect(md).toContain('⚠ 조회 실패(clinic 컨텍스트 확인 필요)');
    // 【8】【9】는 clinic 문구, 【1】치료메모는 정상 '기록 없음'
    expect(md).toContain('# 【8】 활성 패키지');
    expect(md).not.toContain('_활성 패키지 없음_');
    expect(md).toContain('# 【1】 치료메모');
    expect(md).toContain('_기록 없음_'); // 치료메모 = 정상 데이터 없음(회귀)
  });

  test('시나리오2: 전 쿼리 성공·0행(정상 데이터 없음) → 기존 "…없음" 유지, "조회 실패" 아님', async () => {
    const supabase = makeSupabase(allEmpty());
    const env = await fetchProgressAnalysisData(supabase, 'clinic-1', [CUST_ID], TODAY);

    // 에러 0건
    expect(env.fetchErrors?.size).toBe(0);

    const md = buildProgressAnalysisMd(P, env);
    expect(md).not.toContain('⚠ 조회 실패');
    expect(md).toContain('_활성 패키지 없음_');
    expect(md).toContain('_예약내역 없음_');
    expect(md).toContain('_진료내역 없음_');
    expect(md).toContain('_기록 없음_');
  });

  test('시나리오3-a: 데이터 있는 정상 경로 — 출력 무변(회귀0)', () => {
    // buildProgressAnalysisMd 직접(정상 envelope, fetchErrors 없음) — 데이터 표기 확인.
    const env: ProgressAnalysisEnvelope = {
      boilerSet: new Set(),
      milestonesByCust: new Map(),
      visitCountByCust: new Map([[CUST_ID, 3]]),
      nextResvByCust: new Map(),
      memosByCust: new Map(),
      rxByCust: new Map(),
      hqByCust: new Map(),
      firstVisitByCust: new Map(),
      consultByCust: new Map(),
      chartByCust: new Map(),
      visitsByCust: new Map(),
      roomLogsByCheckIn: new Map(),
      activePkgsByCust: new Map([
        [
          CUST_ID,
          [
            {
              package_name: '발톱 12회',
              package_type: 'foot',
              rows: [{ label: '비가열', total: 12, used: 4, remaining: 8 }],
              totalRemaining: 8,
            },
          ],
        ],
      ]),
      reservationsByCust: new Map([
        [
          CUST_ID,
          [
            {
              reservation_date: '2026-08-25',
              reservation_time: '14:30',
              status: 'confirmed',
              booking_memo: '비가열 예정',
              memo: null,
              brief_note: null,
              registrar_name: '이실장',
            },
          ],
        ],
      ]),
      fetchErrors: new Map(),
    };
    const md = buildProgressAnalysisMd(P, env);
    expect(md).not.toContain('⚠ 조회 실패');
    expect(md).toContain('## 패키지 1: 발톱 12회 (foot)');
    expect(md).toContain('| 비가열 | 12회 | 4회 | 8회 |');
    expect(md).toContain('## 2026-08-25 14:30 [예약확정] · 등록 이실장');
    expect(md).toContain('- 예약메모: 비가열 예정');
  });

  test('시나리오3-b: fetchErrors 있어도 데이터 present 면 데이터 우선(회귀 가드 — 에러가 데이터 안 가림)', () => {
    // 방어: 어떤 이유로 fetchErrors 에 기록되어도 리스트가 비어있지 않으면 데이터를 그대로 표기.
    const env: ProgressAnalysisEnvelope = {
      boilerSet: new Set(),
      milestonesByCust: new Map(),
      visitCountByCust: new Map(),
      nextResvByCust: new Map(),
      memosByCust: new Map(),
      rxByCust: new Map(),
      hqByCust: new Map(),
      firstVisitByCust: new Map(),
      consultByCust: new Map(),
      chartByCust: new Map(),
      visitsByCust: new Map(),
      roomLogsByCheckIn: new Map(),
      activePkgsByCust: new Map(),
      reservationsByCust: new Map([
        [
          CUST_ID,
          [
            {
              reservation_date: '2026-08-30',
              reservation_time: '09:00',
              status: 'confirmed',
              booking_memo: '가열 예정',
              memo: null,
              brief_note: null,
              registrar_name: null,
            },
          ],
        ],
      ]),
      fetchErrors: new Map([['reservations', { reason: '일시적 오류', clinicMismatch: false }]]),
    };
    const md = buildProgressAnalysisMd(P, env);
    // 예약 데이터가 있으므로 조회 실패로 가리지 않음
    expect(md).toContain('## 2026-08-30 09:00 [예약확정]');
    expect(md).toContain('- 예약메모: 가열 예정');
    // 활성패키지는 비어있고 error 없음 → 정상 '없음'
    expect(md).toContain('_활성 패키지 없음_');
  });

  test('회귀: fetchErrors 미보유(legacy envelope) → throw 없이 기존 "없음" 표기', () => {
    const legacy: ProgressAnalysisEnvelope = {
      boilerSet: new Set(),
      milestonesByCust: new Map(),
      visitCountByCust: new Map(),
      nextResvByCust: new Map(),
      memosByCust: new Map(),
      rxByCust: new Map(),
      hqByCust: new Map(),
      firstVisitByCust: new Map(),
      consultByCust: new Map(),
      chartByCust: new Map(),
      // 신규 map/fetchErrors 아예 없음
    };
    let md = '';
    expect(() => {
      md = buildProgressAnalysisMd(P, legacy);
    }).not.toThrow();
    expect(md).not.toContain('⚠ 조회 실패');
    expect(md).toContain('_활성 패키지 없음_');
    expect(md).toContain('_예약내역 없음_');
    expect(md).toContain('_진료내역 없음_');
  });
});
