/**
 * T-20260713-foot-UNAUTH WS-A — self_checkin_with_reservation_link WRITE-path 하드닝 DRY-RUN
 * 마이그레이션을 트랜잭션 안에서 적용 → supervisor 행위 회귀검증 5테스트 → ROLLBACK (영속 변경 0).
 * 실제 prod 적용은 supervisor DB 게이트. 무영속: 내부 COMMIT/BEGIN strip + 전체 BEGIN..ROLLBACK 래핑.
 * 사용: SUPABASE_DB_PASSWORD=… node scripts/T-20260713-foot-UNAUTH-WSA-writepath-harden_dryrun.mjs
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ DB 연결 ${new Date().toISOString()} (DRY-RUN — 끝에서 ROLLBACK, 무영속)\n`);
const migPath = 'supabase/migrations/20260713120000_selfcheckin_writepath_harden_masked_reject.sql';
const sql = fs.readFileSync(migPath, 'utf8').split('\n')
  .filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');   // txn-control strip
let pass = true;
try {
  await client.query('BEGIN');
  await client.query(sql);                                       // 함수 교체(트랜잭션 내)
  console.log('── 함수 CREATE OR REPLACE 적용(트랜잭션 내) OK ──');
  // NOTE: 이 러너 = prod 구문 적용 + 무영속(ROLLBACK) + post-probe 확증 전용.
  //   행위 회귀 5테스트(seed→assert)는 faithful-schema(check_ins.customer_name NOT NULL 등 prod 제약
  //   그대로) 로컬 stub 으로 **시크릿 0** 재현 가능 — bash scripts/T-20260713-foot-UNAUTH-WSA_5test_local.sh.
  //   그 stub 이 마스킹 guard 경로의 not-null hard-block 회귀(구 코드 test② FAIL)를 잡아 fix 검증함.
} catch (e) { pass = false; console.error('❌ DRY-RUN 실패:', e.message); }
finally {
  await client.query('ROLLBACK');                                // 무영속 보장
  // post-probe: 함수 정의가 마이그 지문을 포함하지 않아야 함(prod 실재 = 롤백 후 원복 확인)
  const probe = await client.query(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='self_checkin_with_reservation_link' LIMIT 1`);
  const persisted = (probe.rows[0]?.def || '').includes('unlinked_masking_hold');
  console.log(`── post-probe: WS-A 지문 prod 영속? ${persisted ? '❌ PERSISTED(사고)' : '✅ 무영속(정상)'} ──`);
  await client.end();
  process.exit(pass && !persisted ? 0 : 1);
}
