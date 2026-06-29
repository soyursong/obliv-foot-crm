/**
 * T-20260629-foot-HEALTHQ-SELFLINK-REGRESS4 — 라이브 트랜잭션 검증 (BEGIN ... ROLLBACK)
 *
 * 영속 변경 0 — 전부 ROLLBACK. 6/1(20260601173000) 선례와 동일 방식.
 * authenticated JWT(실제 staff)로 fn_health_q_create_token 호출:
 *   STEP A: fix 전(현 prod 정의) 호출 → gen_random_bytes 에러 재현 (회귀 증명)
 *   STEP B: fix 적용(새 마이그 본문) 후 호출 → success + 토큰 (일반/외국인 둘 다)
 *   STEP C: ROLLBACK (prod 무변경)
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const c = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const FIX_BODY = readFileSync(
  new URL('../supabase/migrations/20260629143000_health_q_create_token_searchpath_permanent_fix.sql', import.meta.url),
  'utf8'
)
  // 트랜잭션 제어/notify 는 검증 스크립트가 직접 관리하므로 제거
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '')
  .replace(/SELECT pg_notify\([^;]*\);/g, '');

async function callToken(formType, lang, ctx) {
  // authenticated 역할 + 실제 staff JWT claims 로 호출
  await c.query('SAVEPOINT sp');
  try {
    await c.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: ctx.userId, role: 'authenticated' })]
    );
    await c.query('SET LOCAL ROLE authenticated');
    const r = await c.query(
      `SELECT fn_health_q_create_token($1,$2,$3,NULL,7,$4) AS res`,
      [ctx.customerId, ctx.clinicId, formType, lang]
    );
    await c.query('RESET ROLE');
    return { ok: true, res: r.rows[0].res };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT sp');
    try { await c.query('RESET ROLE'); } catch {}
    return { ok: false, err: e.message };
  }
}

async function main() {
  await c.connect();
  await c.query('BEGIN');

  // 실제 staff + 같은 clinic 의 customer 확보
  const staff = (await c.query(
    `SELECT s.user_id, s.clinic_id FROM staff s WHERE s.user_id IS NOT NULL LIMIT 1`
  )).rows[0];
  if (!staff) throw new Error('staff 없음');
  const cust = (await c.query(
    `SELECT id FROM customers WHERE clinic_id = $1 LIMIT 1`, [staff.clinic_id]
  )).rows[0];
  if (!cust) throw new Error('customer 없음');
  const ctx = { userId: staff.user_id, clinicId: staff.clinic_id, customerId: cust.id };
  console.log('컨텍스트:', ctx);

  console.log('\n===== STEP A: fix 전 (현 prod 정의) =====');
  for (const [ft, lang] of [['general', 'ko'], ['general', 'en']]) {
    const a = await callToken(ft, lang, ctx);
    console.log(`  [${ft}/${lang}]`, a.ok ? `결과=${JSON.stringify(a.res)}` : `🔴 에러: ${a.err}`);
  }

  console.log('\n===== fix 적용 (CREATE OR REPLACE, 트랜잭션 내) =====');
  await c.query(FIX_BODY);
  const after = (await c.query(
    `SELECT proconfig, (prosrc ILIKE '%extensions.gen_random_bytes%') AS body_qualified
     FROM pg_proc WHERE proname='fn_health_q_create_token'
       AND pg_get_function_identity_arguments(oid) LIKE '%p_lang%' LIMIT 1`
  )).rows[0];
  console.log('  적용 후 proconfig:', JSON.stringify(after.proconfig), '| body_qualified:', after.body_qualified);

  console.log('\n===== STEP B: fix 후 (일반/외국인 둘 다) =====');
  for (const [ft, lang] of [['general', 'ko'], ['general', 'en']]) {
    const b = await callToken(ft, lang, ctx);
    const res = b.ok ? b.res : null;
    const success = res && res.success === true && !!res.token;
    console.log(`  [${ft}/${lang}]`, success ? `🟢 success token=${res.token.slice(0, 12)}…(len ${res.token.length})` : `❌ ${JSON.stringify(b.ok ? res : b.err)}`);
  }

  console.log('\n===== STEP C: ROLLBACK (prod 무변경) =====');
  await c.query('ROLLBACK');
  // 검증: prod 는 여전히 fix 전 상태여야 함
  const prodNow = (await c.query(
    `SELECT proconfig FROM pg_proc WHERE proname='fn_health_q_create_token'
       AND pg_get_function_identity_arguments(oid) LIKE '%p_lang%' LIMIT 1`
  )).rows[0];
  console.log('  ROLLBACK 후 prod proconfig (여전히 미적용 확인):', JSON.stringify(prodNow.proconfig));

  await c.end();
}
main().catch(async (e) => { try { await c.query('ROLLBACK'); } catch {}; console.error('ERROR:', e.message); await c.end().catch(()=>{}); process.exit(1); });
