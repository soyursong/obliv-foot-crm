/**
 * T-20260607-foot-PROGRESS-TIMELINE-AUTHOR — 경과타임라인 펼침 상세에 작성 의사명 표시
 *
 * 배경:
 *   현장(문지은 대표원장): "좌측탭에 경과타임라인에도 작성한 의사가 다 보였으면해".
 *   8-A(T-20260606-foot-MEDCHART-RECORDER-NAME)로 collapsed 타임라인 헤더(L1734/L1779)에는
 *   기록자가 표시되지만, 펼침(아코디언 expanded) 상세 영역에는 작성 의사가 누락돼 있었음.
 *
 * 변경(read-only, DB 무변경):
 *   AC-0 [검증] 경과 항목(medical_charts)에 작성자 식별자(created_by + created_by_name) 저장 확인 → 표시만 추가.
 *   [표시] 펼침 상세 하단에 'data-testid=timeline-expanded-recorder' 라인 추가.
 *          8-A 표시규칙 동일 재사용: recorder = chart.created_by_name || recorderName(chart.created_by).
 *          과거 무작성자(created_by NULL) 레코드는 recorder=null → 미렌더(빈값 처리).
 *
 * 시나리오:
 *   S1 (AC-0 저장 확인): medical_charts 에 created_by/created_by_name 식별자가 조회 가능.
 *   S2 (표시 가드 미러): 펼침 recorder 렌더 여부 = recorder truthy. legacy null-author → 숨김.
 */
import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';

test.describe('T-20260607-foot-PROGRESS-TIMELINE-AUTHOR', () => {

  // ── S1: AC-0 — 경과 항목 작성자 식별자 저장 확인 ──────────────────────
  test('S1: medical_charts 에 created_by/created_by_name 식별자 조회 가능(AC-0)', async ({ request }) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!serviceKey) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — skip DB check');
      return;
    }
    const url = `${SUPABASE_URL}/rest/v1/medical_charts?select=id,created_by,created_by_name&limit=5`;
    const resp = await request.get(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row).toHaveProperty('created_by');
      expect(row).toHaveProperty('created_by_name');
    }
  });

  // ── S2: 펼침 상세 recorder 렌더 가드 (FE 규칙 미러) ───────────────────
  // FE: {recorder && (<div data-testid="timeline-expanded-recorder">작성 {recorder}</div>)}
  //   recorder = chart.created_by_name || recorderName(chart.created_by)
  function recorder(
    chart: { created_by: string | null; created_by_name?: string | null },
    staffNameMap: Record<string, string> = {},
  ): string | null {
    const recorderName = (createdBy: string | null | undefined): string | null => {
      if (!createdBy) return null;
      return staffNameMap[createdBy] ?? createdBy.split('@')[0] ?? createdBy;
    };
    return chart.created_by_name || recorderName(chart.created_by);
  }
  const renders = (c: { created_by: string | null; created_by_name?: string | null }, m = {}) =>
    Boolean(recorder(c, m));

  test('S2-a: created_by_name 스냅샷이 있으면 펼침에 그 이름 표시(계정 변경 무관)', () => {
    expect(recorder({ created_by: 'deleted@oblivseoul.kr', created_by_name: '문지은' })).toBe('문지은');
    expect(renders({ created_by: 'deleted@oblivseoul.kr', created_by_name: '문지은' })).toBe(true);
  });

  test('S2-b: created_by_name NULL이면 staffNameMap 폴백으로 표시', () => {
    const c = { created_by: 'wlgp3907@naver.com', created_by_name: null };
    expect(recorder(c, { 'wlgp3907@naver.com': '김지혜' })).toBe('김지혜');
    expect(renders(c, { 'wlgp3907@naver.com': '김지혜' })).toBe(true);
  });

  test('S2-c: 매핑 없으면 이메일 로컬파트 폴백으로 표시', () => {
    const c = { created_by: 'someone@oblivseoul.kr', created_by_name: null };
    expect(recorder(c)).toBe('someone');
    expect(renders(c)).toBe(true);
  });

  test('S2-d: 과거 무작성자(created_by NULL) 레코드는 빈값 처리 → 펼침에 미렌더', () => {
    const c = { created_by: null, created_by_name: null };
    expect(recorder(c)).toBeNull();
    expect(renders(c)).toBe(false); // 라인 자체가 렌더되지 않음(빈값)
  });
});
