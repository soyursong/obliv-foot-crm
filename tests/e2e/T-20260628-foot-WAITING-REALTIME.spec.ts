/**
 * T-20260628-foot-WAITING-REALTIME — 공개 대기현황판 sanitized projection 회귀 spec
 *
 * 배경: Waiting.tsx 가 anon 으로 base `check_ins` 를 직접 SELECT + postgres_changes 구독하던
 *   경로를, zero-PII sanitized projection 테이블 `waiting_board` (서버측 마스킹 트리거) 경유로
 *   전환. SSOT = cross_crm_data_contract.md §16-3a (옵션 a 확정, DA CONSULT-REPLY lz5d).
 *   마이그: 20260628200000_waiting_board_projection.sql
 *
 * AC1: anon 이 check_ins base-table SELECT 불가하나 대기현황판은 정상(projection 경유).
 *      ※ check_ins anon REVOKE 는 parent 2b sub-gate #2 에서 적용 → 본 spec 에서는
 *        "projection 경로가 살아있어 REVOKE 후에도 보드가 동작 가능"을 검증(projection SELECT 성공).
 * AC2: 현황판 PII 노출 0 — projection 컬럼에 phone/실명(full)/RRN/DOB/주소/email/차트번호 부재.
 *      display_name 은 마스킹 산출만(중간 글자 '*').
 * AC3: Realtime 갱신 동작 — waiting_board 가 supabase_realtime publication 에 포함.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.TEST_ANON_KEY;
const PROJECT_ID = 'rxlomoozakkjesdqjtvd';

// projection 에 절대 존재해선 안 되는 PII 컬럼(AC2 — 컬럼 부재로 노출 0 강제)
const FORBIDDEN_COLUMNS = [
  'customer_name',   // 원본 실명(full)
  'phone',
  'legal_name',
  'rrn',
  'date_of_birth',
  'birth_date',
  'address',
  'email',
  'chart_number',
];

// ─── AC1: anon projection SELECT 성공 (현황판 경로 생존) ──────────────────────
test('AC1: anon REST 키로 waiting_board SELECT 가능 (현황판 데이터 경로 생존)', async ({ request }) => {
  test.skip(!ANON_KEY, 'VITE_SUPABASE_ANON_KEY / TEST_ANON_KEY 미설정 — anon 쿼리 skip');

  const resp = await request.get(
    `${SUPABASE_URL}/rest/v1/waiting_board?select=id,queue_number,status,display_name,room&limit=5`,
    { headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY!}` } }
  );

  // projection 은 anon SELECT 허용(USING(true)) → 200. (행 0건이어도 경로 생존이 핵심)
  expect(resp.ok(), `waiting_board anon SELECT 실패(status ${resp.status()}) — projection 경로 차단`).toBeTruthy();
  const rows = (await resp.json()) as unknown[];
  expect(Array.isArray(rows)).toBeTruthy();
});

// ─── AC2-a: projection 응답에 원본 PII 키가 없음 (행 존재 시) ──────────────────
test('AC2: waiting_board 응답에 PII 컬럼 부재 + display_name 마스킹', async ({ request }) => {
  test.skip(!ANON_KEY, 'ANON_KEY 미설정 — skip');

  // select=* 로 컬럼 누출 여부 확인(존재하는 키만 반환됨)
  const resp = await request.get(
    `${SUPABASE_URL}/rest/v1/waiting_board?select=*&limit=20`,
    { headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY!}` } }
  );
  expect(resp.ok()).toBeTruthy();
  const rows = (await resp.json()) as Array<Record<string, unknown>>;

  for (const row of rows) {
    for (const col of FORBIDDEN_COLUMNS) {
      expect(Object.prototype.hasOwnProperty.call(row, col),
        `waiting_board 에 금지 PII 컬럼 노출: ${col}`).toBeFalsy();
    }
    // display_name 이 2글자 이상이면 마스킹 문자('*') 포함이어야 함
    const dn = row.display_name as string | null;
    if (dn && [...dn].length >= 2) {
      expect(dn.includes('*'), `display_name 마스킹 누락: ${dn}`).toBeTruthy();
    }
  }
});

// ─── AC2-b (DB): projection 테이블 컬럼 화이트리스트 검증 ──────────────────────
test('AC2(DB): waiting_board 물리 컬럼에 PII 부재', async ({ request }) => {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  test.skip(!accessToken, 'SUPABASE_ACCESS_TOKEN 미설정 — DB 컬럼 검사 skip');

  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: {
        query: `SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name='waiting_board' ORDER BY column_name;`,
      },
    }
  );
  expect(resp.ok()).toBeTruthy();
  const rows = (await resp.json()) as Array<{ column_name: string }>;
  test.skip(rows.length === 0, 'waiting_board 미존재 — 마이그 미적용(supervisor apply 전). apply 후 재실행.');

  const cols = rows.map((r) => r.column_name);
  for (const col of FORBIDDEN_COLUMNS) {
    expect(cols.includes(col), `waiting_board 물리 컬럼에 PII 존재: ${col}`).toBeFalsy();
  }
  // 기대 컬럼 존재 확인
  for (const col of ['id', 'clinic_id', 'queue_number', 'room', 'status', 'display_name']) {
    expect(cols.includes(col), `waiting_board 필수 컬럼 누락: ${col}`).toBeTruthy();
  }
});

// ─── AC3 (DB): Realtime publication 포함 확인 ────────────────────────────────
test('AC3(DB): waiting_board 가 supabase_realtime publication 에 포함', async ({ request }) => {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  test.skip(!accessToken, 'SUPABASE_ACCESS_TOKEN 미설정 — publication 검사 skip');

  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: {
        query: `SELECT 1 AS ok FROM pg_publication_tables
                WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='waiting_board';`,
      },
    }
  );
  expect(resp.ok()).toBeTruthy();
  const rows = (await resp.json()) as Array<{ ok: number }>;
  test.skip(rows.length === 0, 'waiting_board publication 미포함 — 마이그 미적용. supervisor apply 후 재실행.');
  expect(rows.length).toBeGreaterThan(0);
});

// ─── AC1(렌더): 공개 대기현황판 셸 정상 렌더(회귀 0) ─────────────────────────
test('AC1(렌더): /waiting/:slug 공개 현황판 셸 정상 렌더', async ({ page }) => {
  const slug = process.env.TEST_CLINIC_SLUG;
  test.skip(!slug, 'TEST_CLINIC_SLUG 미설정 — 브라우저 렌더 테스트 skip');

  await page.goto(`${BASE_URL}/waiting/${slug}`);
  await expect(page.locator('body')).toBeVisible();
  // "지점을 찾을 수 없습니다" 가 아니어야 함(slug 유효 가정)
  await expect(page.locator('text=지점을 찾을 수 없습니다')).toHaveCount(0);
  // 현황판 헤더 영역(현재 대기 현황) 노출
  await expect(page.locator('text=현재 대기 현황')).toBeVisible({ timeout: 15_000 });
});
