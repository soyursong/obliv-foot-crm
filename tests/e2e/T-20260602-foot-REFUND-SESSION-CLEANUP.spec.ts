/**
 * T-20260602-foot-REFUND-SESSION-CLEANUP — refund_package_atomic 세션 cascade 회귀 테스트
 *
 * 검증 대상: 패키지 환불 시 잔존 package_sessions(status='used')가 'refunded'로 전이되어
 *           used 필터 기반 모든 집계(get_package_remaining/calc_refund_amount/foot_stats_by_category)에서
 *           자동 제외되는가 (유령 세션 방지, AC-1/AC-2).
 *
 * 방식: 단일 트랜잭션 안에서 최소 패키지+세션을 생성 → refund_package_atomic 호출 →
 *       세션·패키지 status 전이 검증 → 무조건 ROLLBACK (운영 데이터 무오염).
 *
 * DB 직결(pooler, SUPABASE_DB_PASSWORD). FE 무관 — 본 티켓은 DB RPC 단독 변경.
 * author: dev-foot / 2026-06-03
 */
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function dbPassword(): string {
  let pw = process.env.SUPABASE_DB_PASSWORD;
  try {
    for (const line of readFileSync(join(__dirname, '../../.env'), 'utf8').split('\n')) {
      const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
      if (m) pw = m[1].trim();
    }
  } catch { /* env optional */ }
  return pw ?? '';
}

test.describe('refund_package_atomic — package_sessions cascade', () => {
  test('환불 시 used 세션이 refunded로 전이되어 used 집계에서 제외된다', async () => {
    const pw = dbPassword();
    test.skip(!pw, 'SUPABASE_DB_PASSWORD 미설정 — DB 회귀 테스트 건너뜀');

    const client = new pg.Client({
      host: 'aws-1-ap-southeast-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.rxlomoozakkjesdqjtvd',
      password: pw,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    try {
      // 1) 함수 정의에 cascade 가 포함됐는지 (마이그레이션 적용 스모크)
      const def = await client.query(
        `SELECT (pg_get_functiondef(oid) ILIKE '%package_sessions%') AS has_cascade
           FROM pg_proc WHERE proname = 'refund_package_atomic' LIMIT 1;`,
      );
      expect(def.rows[0]?.has_cascade, 'refund_package_atomic 에 package_sessions cascade 미포함').toBe(true);

      // 2) 트랜잭션 내 행동 검증 (항상 ROLLBACK)
      await client.query('BEGIN');

      const clinic = await client.query(`SELECT id FROM clinics LIMIT 1`);
      const customer = await client.query(`SELECT id FROM customers LIMIT 1`);
      const clinicId = clinic.rows[0]?.id;
      const customerId = customer.rows[0]?.id;
      expect(clinicId, '테스트용 clinic 없음').toBeTruthy();
      expect(customerId, '테스트용 customer 없음').toBeTruthy();

      const pkgRes = await client.query(
        `INSERT INTO packages
           (clinic_id, customer_id, package_name, package_type, total_sessions,
            heated_sessions, total_amount, paid_amount, status,
            heated_unit_price, unheated_unit_price, iv_unit_price)
         VALUES ($1,$2,'[TEST] 환불세션정리','custom',2, 2, 200000, 200000, 'active', 100000, 0, 0)
         RETURNING id;`,
        [clinicId, customerId],
      );
      const pkgId = pkgRes.rows[0].id;

      await client.query(
        `INSERT INTO package_sessions (package_id, session_number, session_type, status, unit_price)
         VALUES ($1, 1, 'heated_laser', 'used', 100000),
                ($1, 2, 'heated_laser', 'used', 100000);`,
        [pkgId],
      );

      const usedBefore = await client.query(
        `SELECT count(*)::int AS n FROM package_sessions WHERE package_id=$1 AND status='used';`,
        [pkgId],
      );
      expect(usedBefore.rows[0].n).toBe(2);

      // 환불 실행
      const refund = await client.query(
        `SELECT refund_package_atomic($1,$2,$3,'card') AS res;`,
        [pkgId, clinicId, customerId],
      );
      expect(refund.rows[0].res?.ok, `환불 RPC 실패: ${JSON.stringify(refund.rows[0].res)}`).toBe(true);

      // 패키지 status 전이
      const pkgAfter = await client.query(`SELECT status FROM packages WHERE id=$1;`, [pkgId]);
      expect(pkgAfter.rows[0].status).toBe('refunded');

      // 핵심: used 세션 0건, refunded 세션 2건
      const usedAfter = await client.query(
        `SELECT count(*)::int AS n FROM package_sessions WHERE package_id=$1 AND status='used';`,
        [pkgId],
      );
      const refundedAfter = await client.query(
        `SELECT count(*)::int AS n FROM package_sessions WHERE package_id=$1 AND status='refunded';`,
        [pkgId],
      );
      expect(usedAfter.rows[0].n, '환불 후 used(유령) 세션 잔류').toBe(0);
      expect(refundedAfter.rows[0].n, '환불 후 refunded 세션 미전이').toBe(2);

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await client.end();
    }
  });
});
