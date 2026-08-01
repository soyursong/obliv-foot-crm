/**
 * E2E — T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK
 * 2번차트 2구역 [지정(담당) 치료사] 쓰기 — 치료사(therapist) 계정 차단 (admin/manager/consultant/coordinator 限).
 *
 * 핵심 요구(GO_WARN): FE 숨김/비활성 + 백엔드(트리거) 쓰기 차단 둘 다.
 *   FE 게이트는 T-20260722-foot-DESIG-THERAPIST-ROLE-GATE spec 이 커버(select disabled/title/회색).
 *   본 spec 은 백엔드 강제(치료사 세션 토큰 API 직접 호출 → 거부)를 검증한다 — FE 숨김만으로 통과 X.
 *
 * SC-B1 (핵심): 치료사 세션으로 customers.designated_therapist_id API 직접 UPDATE → 거부(에러/0-row).
 * SC-B2:        admin/manager/consultant/coordinator 세션으로 동일 UPDATE → 성공.
 * SC-B3 (엣지): 치료사 세션에서 designated 미포함 customers UPDATE(예: 값 무변경) → 통과(6menu 유지, 트리거 no-op).
 *
 * 환경변수(미구성 시 skip — CI 시드 보호, 기존 DESIGNATED-THERAPIST spec 관례):
 *   PLAYWRIGHT_SUPABASE_URL            : Supabase URL
 *   PLAYWRIGHT_SUPABASE_ANON_KEY       : anon/publishable key
 *   PLAYWRIGHT_SEED_CUSTOMER_ID        : 대상 고객 id
 *   PLAYWRIGHT_SEED_THERAPIST_STAFF_ID : 지정할 치료사 staff id
 *   PLAYWRIGHT_THERAPIST_JWT           : therapist role 계정 access token (차단 대상)
 *   PLAYWRIGHT_EDITOR_JWT              : admin/manager/consultant/coordinator 계정 access token (허용 대상)
 */

import { test, expect } from '@playwright/test';

const SB_URL = process.env.PLAYWRIGHT_SUPABASE_URL;
const SB_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY;
const CUSTOMER_ID = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;
const THERAPIST_STAFF_ID = process.env.PLAYWRIGHT_SEED_THERAPIST_STAFF_ID;
const THERAPIST_JWT = process.env.PLAYWRIGHT_THERAPIST_JWT;
const EDITOR_JWT = process.env.PLAYWRIGHT_EDITOR_JWT;

const HAS_CORE = !!(SB_URL && SB_ANON && CUSTOMER_ID && THERAPIST_STAFF_ID);

// PostgREST 직접 PATCH — 지정 치료사 컬럼 UPDATE. return=representation 으로 반영 row 확인.
async function patchDesignated(jwt: string, value: string | null) {
  const res = await fetch(
    `${SB_URL}/rest/v1/customers?id=eq.${CUSTOMER_ID}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SB_ANON!,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ designated_therapist_id: value }),
    },
  );
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test.describe('T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK — 백엔드 쓰기 차단', () => {

  test('SC-B1: 치료사 세션 API 직접 UPDATE → 거부 (42501/에러 or 0-row)', async () => {
    test.skip(!HAS_CORE, '시드/URL 미구성 — CI skip');
    test.skip(!THERAPIST_JWT, 'therapist JWT 미주입 — CI skip');

    const { status, body } = await patchDesignated(THERAPIST_JWT!, THERAPIST_STAFF_ID!);

    // 트리거 RAISE(42501) → PostgREST 403/400 에러 응답, 또는(정책 조합에 따라) 0-row 반영.
    const denied =
      status >= 400 ||
      (Array.isArray(body) && body.length === 0);
    expect(denied, `치료사 쓰기가 거부되어야 함. status=${status} body=${JSON.stringify(body)}`).toBeTruthy();

    // 값이 실제로 반영되지 않았는지(대상 staff id 로 안 바뀜) 확인
    if (Array.isArray(body) && body.length > 0) {
      expect((body[0] as { designated_therapist_id?: string }).designated_therapist_id)
        .not.toBe(THERAPIST_STAFF_ID);
    }
  });

  test('SC-B2: 편집 허용 role 세션 API UPDATE → 성공', async () => {
    test.skip(!HAS_CORE, '시드/URL 미구성 — CI skip');
    test.skip(!EDITOR_JWT, 'editor JWT 미주입 — CI skip');

    const { status, body } = await patchDesignated(EDITOR_JWT!, THERAPIST_STAFF_ID!);
    expect(status, `허용 role 쓰기는 성공해야 함. body=${JSON.stringify(body)}`).toBeLessThan(300);
    expect(Array.isArray(body) && body.length > 0).toBeTruthy();
    if (Array.isArray(body) && body.length > 0) {
      expect((body[0] as { designated_therapist_id?: string }).designated_therapist_id).toBe(THERAPIST_STAFF_ID);
    }
  });

  test('SC-B3(엣지): 치료사 세션 — designated 값 무변경 재저장은 통과(트리거 no-op)', async () => {
    test.skip(!HAS_CORE, '시드/URL 미구성 — CI skip');
    test.skip(!THERAPIST_JWT, 'therapist JWT 미주입 — CI skip');

    // 현재 값을 읽어 동일 값으로 재저장 → IS DISTINCT FROM = false → 트리거 통과(6menu 다른 컬럼 write 무영향 대리 검증)
    const read = await fetch(
      `${SB_URL}/rest/v1/customers?id=eq.${CUSTOMER_ID}&select=designated_therapist_id`,
      { headers: { apikey: SB_ANON!, Authorization: `Bearer ${THERAPIST_JWT}` } },
    );
    const rows = (await read.json()) as { designated_therapist_id: string | null }[];
    test.skip(!Array.isArray(rows) || rows.length === 0, '대상 고객 조회 불가 — skip');
    const current = rows[0].designated_therapist_id;

    const { status } = await patchDesignated(THERAPIST_JWT!, current);
    // 동일값 재저장은 트리거가 막지 않아야 함(권한오류 아님).
    expect(status, `동일값 재저장은 통과해야 함(no-op). status=${status}`).toBeLessThan(400);
  });

});
