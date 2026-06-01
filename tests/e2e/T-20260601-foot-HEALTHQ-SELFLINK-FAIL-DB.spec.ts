/**
 * DB-layer 회귀 spec — T-20260601-foot-HEALTHQ-SELFLINK-FAIL (ESCALATION-2)
 *
 * 진짜 근본원인: 토큰 발급 SECURITY DEFINER 함수 3종의 search_path 가 {public} 으로
 *   고정되어, extensions 스키마의 gen_random_bytes 를 해석하지 못함.
 *   → authenticated 역할(=현장)로 호출 시 "function gen_random_bytes(integer) does not exist"
 *     로 100% 실패. (superuser 직접 호출은 권한 체크에서 먼저 막혀 이 에러를 못 봄 → 검증 모순.)
 *
 * 수정: 함수 3종 search_path 에 extensions 추가 + 컬럼 DEFAULT 의 gen_random_bytes 스키마 한정.
 *
 * 본 spec 은 UI 보다 결정적인 DB 레이어 가드:
 *   1) 함수 3종 proconfig search_path 에 'extensions' 가 포함되어야 한다.
 *   2) authenticated 역할 컨텍스트에서 fn_health_q_create_token 이 success=true + url-safe 토큰을
 *      반환해야 한다(토큰 INSERT 는 ROLLBACK 으로 정리, prod 데이터 무오염).
 *
 * 환경: VITE_SUPABASE_URL / SUPABASE_DB_PASSWORD 필요. 없으면 skip.
 */
import { test, expect } from '@playwright/test';
import pg from 'pg';

const { Client } = pg;

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const DB_HOST =
  process.env.SUPABASE_DB_HOST ?? 'aws-1-ap-southeast-1.pooler.supabase.com';
const DB_USER = process.env.SUPABASE_DB_USER ?? 'postgres.rxlomoozakkjesdqjtvd';

const TOKEN_FNS = [
  'fn_health_q_create_token',
  'fn_selfcheckin_create_health_q_token',
  'fn_dashboard_reissue_health_q_token',
];

// 검증용 known 데이터 (라이브 시드)
const STAFF_USER_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12'; // 김주연 auth.users.id
const CUSTOMER_ID = '747286b0-045d-472d-ad87-3d49c42c40b5';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

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

test.describe('T-20260601-HEALTHQ-SELFLINK-FAIL — DB search_path 회귀', () => {
  test.skip(!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 미설정 — DB 레이어 spec skip');

  test('AC-1: 토큰 발급 함수 3종 search_path 에 extensions 포함', async () => {
    await withClient(async (c) => {
      const { rows } = await c.query(
        `SELECT proname, proconfig FROM pg_proc WHERE proname = ANY($1)`,
        [TOKEN_FNS],
      );
      expect(rows.length, '3개 함수 모두 존재해야 함').toBe(TOKEN_FNS.length);
      for (const r of rows) {
        const cfg: string[] = r.proconfig ?? [];
        const sp = cfg.find((x) => x.startsWith('search_path='));
        expect(sp, `${r.proname}: search_path proconfig 필요`).toBeTruthy();
        expect(
          sp,
          `${r.proname}: search_path 에 extensions 필요 (gen_random_bytes 해석)`,
        ).toContain('extensions');
      }
    });
  });

  test('AC-2: authenticated 역할로 fn_health_q_create_token success + url-safe 토큰', async () => {
    await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(
          `SELECT set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub: STAFF_USER_ID, role: 'authenticated' })],
        );
        await c.query('SET LOCAL ROLE authenticated');
        const { rows } = await c.query(
          `SELECT fn_health_q_create_token($1::uuid,$2::uuid,'general',NULL,7) AS result`,
          [CUSTOMER_ID, CLINIC_ID],
        );
        const result = rows[0].result as {
          success: boolean;
          token?: string;
          error?: string;
        };
        expect(result.success, `unauthorized/에러여서는 안 됨: ${result.error ?? ''}`).toBe(true);
        expect(result.token, '토큰 발급 필요').toBeTruthy();
        // url-safe: +, /, = 가 없어야 함
        expect(result.token).not.toMatch(/[+/=]/);
      } finally {
        await c.query('ROLLBACK'); // prod 데이터 무오염
      }
    });
  });
});
