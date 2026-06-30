/**
 * DB-layer 회귀 spec — T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM
 *
 * 화면: 2번차트 → 펜차트 → 발건강 질문지 [링크 생성] (HealthQResultsPanel.handleCreateToken)
 *   → fn_health_q_create_token(6-arg) RPC.
 *
 * ── 확정 RC (PROD READ-ONLY 실측, 2026-06-30) ──
 *   fn_health_q_create_token 의 인가 게이트가 "비정규" 신원(staff.user_id = auth.uid())만 사용.
 *   로그인 신원은 user_profiles 기준인데 staff.user_id 는 희소 → coordinator 7명 중 staff.user_id
 *   미연결 5명이 'unauthorized' 반환 → 링크 생성 실패. (FE 역할게이트/RLS admin한정 가설은 반증 —
 *   HealthQResultsPanel 의 [링크 생성] 버튼은 role gate 없음, RPC EXECUTE=authenticated 전역.)
 *
 * ── 수정 (인가 게이트만, ADDITIVE 무회귀) ──
 *   인가 = 정규신원(is_approved_user() AND clinic) OR 레거시(staff.user_id) 의 union.
 *   migration: supabase/migrations/20260630181500_health_q_create_token_canonical_identity.sql
 *   rollback : supabase/migrations/20260630181500_health_q_create_token_canonical_identity.rollback.sql
 *
 * 본 spec 은 UI 보다 결정적인 DB 레이어 가드(인가 분기 = DB 함수 1점):
 *   AC-0: 함수 source 에 ADDITIVE union(정규신원 OR staff) 분기가 적용돼 있어야 한다(정적 가드).
 *   AC-1: [RC 결정타] staff 미연결 + approved coordinator(=정규신원만) 컨텍스트에서 토큰 생성 success=true.
 *          (rollback 정의였다면 동일 컨텍스트는 unauthorized → 회귀를 잡는 핵심 단언.)
 *   AC-2: [무회귀] staff 연결자(legacy 게이트 통과자) 여전히 success=true.
 *   AC-3/AC-4: [보안·과개방 금지] 미승인·미연결 임의 신원은 여전히 unauthorized (ADDITIVE 가 전역 개방 아님).
 *   AC-4: [토큰 본체 무변경] search_path 에 extensions 포함 + 발급 토큰 url-safe(+,/,= 없음, REGRESS4 보존).
 *
 *   모든 토큰 INSERT 는 BEGIN..ROLLBACK 으로 정리 → prod 데이터 무오염.
 *
 * 환경: SUPABASE_DB_PASSWORD 필요. 없으면 skip.
 */
import { test, expect } from '@playwright/test';
import pg from 'pg';

const { Client } = pg;

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const DB_HOST =
  process.env.SUPABASE_DB_HOST ?? 'aws-1-ap-southeast-1.pooler.supabase.com';
const DB_USER = process.env.SUPABASE_DB_USER ?? 'postgres.rxlomoozakkjesdqjtvd';

// 라이브 시드(REGRESS4 spec 과 동일) — staff 연결자(김주연) + 기본 clinic
const STAFF_USER_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12'; // 김주연 auth.users.id (staff 연결)
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const RANDOM_UNAPPROVED_ID = '00000000-0000-0000-0000-000000000000';

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: DB_HOST,
    port: 5432,
    database: 'postgres',
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

type TokenResult = { success: boolean; token?: string; error?: string };

/** 주어진 jwt sub(=auth.uid()) 컨텍스트로 fn_health_q_create_token 호출 후 ROLLBACK. */
async function createTokenAs(
  c: pg.Client,
  sub: string,
  customerId: string,
  clinicId: string,
): Promise<TokenResult> {
  await c.query('BEGIN');
  try {
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub, role: 'authenticated' }),
    ]);
    await c.query('SET LOCAL ROLE authenticated');
    const { rows } = await c.query(
      `SELECT fn_health_q_create_token($1::uuid,$2::uuid,'general',NULL,7,'ko') AS result`,
      [customerId, clinicId],
    );
    return rows[0].result as TokenResult;
  } finally {
    await c.query('ROLLBACK'); // prod 데이터 무오염
  }
}

/** clinic 내 임의 고객 1명 (토큰 발급 대상). 없으면 null. */
async function anyCustomer(c: pg.Client, clinicId: string): Promise<string | null> {
  const { rows } = await c.query(
    `SELECT id FROM customers WHERE clinic_id = $1 LIMIT 1`,
    [clinicId],
  );
  return rows[0]?.id ?? null;
}

test.describe('T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM — create-token 인가 정규신원 전환', () => {
  test.skip(!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 미설정 — DB 레이어 spec skip');

  test('AC-0: fn_health_q_create_token source 에 정규신원(is_approved_user) OR staff ADDITIVE union 적용', async () => {
    await withClient(async (c) => {
      const { rows } = await c.query(
        `SELECT pg_get_functiondef(p.oid) AS def
           FROM pg_proc p
          WHERE p.proname = 'fn_health_q_create_token'
          LIMIT 1`,
      );
      expect(rows.length, '함수 존재 필요').toBe(1);
      const def: string = rows[0].def;
      // 정규신원 게이트 + 레거시 staff 게이트가 OR 로 공존(ADDITIVE union)
      expect(def, 'is_approved_user() 정규신원 게이트 필요').toContain('is_approved_user()');
      expect(def, 'current_user_clinic_id() clinic 가드 필요').toContain('current_user_clinic_id()');
      expect(def, 'legacy staff 게이트(union) 보존 필요').toMatch(/v_staff_id\s+IS\s+NOT\s+NULL/i);
      // AC-4: 토큰 본체(REGRESS4) 보존 — extensions.gen_random_bytes + url-safe translate
      expect(def, 'REGRESS4 토큰 본체(extensions.gen_random_bytes) 보존 필요').toContain(
        'extensions.gen_random_bytes',
      );
      expect(def, 'search_path 에 extensions 필요').toContain('extensions');
    });
  });

  test('AC-1: [RC 결정타] staff 미연결 approved coordinator(정규신원만) 토큰 생성 success=true', async () => {
    await withClient(async (c) => {
      // staff 미연결 + approved + active + clinic-bound coordinator 후보 동적 선정
      const { rows: cand } = await c.query(
        `SELECT up.id, up.clinic_id
           FROM user_profiles up
          WHERE up.role = 'coordinator'
            AND COALESCE(up.approved, false) = true
            AND COALESCE(up.active, true) = true
            AND up.clinic_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM staff s
               WHERE s.user_id = up.id AND s.clinic_id = up.clinic_id
            )
          LIMIT 1`,
      );
      test.skip(
        cand.length === 0,
        'staff 미연결 approved coordinator 후보 없음 — RC outlier 부재 환경(skip)',
      );
      const coordId: string = cand[0].id;
      const clinicId: string = cand[0].clinic_id;
      const customerId = await anyCustomer(c, clinicId);
      test.skip(!customerId, `clinic ${clinicId} 고객 없음 — skip`);

      const res = await createTokenAs(c, coordId, customerId!, clinicId);
      expect(
        res.success,
        `정규신원 coordinator 가 unauthorized 면 RC 미수정/회귀: ${res.error ?? ''}`,
      ).toBe(true);
      expect(res.token, '토큰 발급 필요').toBeTruthy();
      expect(res.token, 'url-safe 토큰(REGRESS4)').not.toMatch(/[+/=]/);
    });
  });

  test('AC-2: [무회귀] staff 연결자(legacy 게이트) 토큰 생성 success=true', async () => {
    await withClient(async (c) => {
      const customerId = await anyCustomer(c, CLINIC_ID);
      test.skip(!customerId, `clinic ${CLINIC_ID} 고객 없음 — skip`);
      const res = await createTokenAs(c, STAFF_USER_ID, customerId!, CLINIC_ID);
      expect(res.success, `staff 연결자 회귀: ${res.error ?? ''}`).toBe(true);
      expect(res.token).toBeTruthy();
    });
  });

  test('AC-3/AC-4: [과개방 금지] 미승인·미연결 임의 신원은 여전히 unauthorized', async () => {
    await withClient(async (c) => {
      const customerId = await anyCustomer(c, CLINIC_ID);
      test.skip(!customerId, `clinic ${CLINIC_ID} 고객 없음 — skip`);
      const res = await createTokenAs(c, RANDOM_UNAPPROVED_ID, customerId!, CLINIC_ID);
      expect(res.success, 'ADDITIVE union 이 전역 개방이어선 안 됨').toBe(false);
      expect(res.error).toBe('unauthorized');
    });
  });
});
