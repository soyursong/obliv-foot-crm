/**
 * T-20260719-foot-SELFCHECKIN-RRN-ENC-CONSENTLESS-PATH-DIAG — READ-ONLY 진단 probe
 *
 * ⚠ READ-ONLY. SELECT/introspection 전용. INSERT/UPDATE/DELETE/DDL 절대 없음.
 * 목적:
 *   1) 배포된 resolve_v3 / update_personal_info / rrn_match 정의에서 rrn_enc/birth_date write 여부 확정.
 *   2) rrn_enc 을 write 하는 함수 전수(pg_proc 본문 grep) — 저장경로 특정.
 *   3) created_by IS NULL 신규 고객의 rrn_enc / birth_date / consent_sensitive 실분포 (최근 14일).
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
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결 (read-only probe)\n');

// ── 1) rrn_enc 을 write(SET/INSERT) 하는 함수 전수 ──
const rrnWriters = await c.query(`
  SELECT proname, prosecdef,
         (pg_get_functiondef(oid) ~* 'rrn_enc[[:space:]]*=') AS sets_rrn_enc_update,
         (pg_get_functiondef(oid) ~* 'pgp_sym_encrypt')      AS calls_encrypt
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND pg_get_functiondef(oid) ~* 'rrn_enc'
    AND (pg_get_functiondef(oid) ~* 'rrn_enc[[:space:]]*=' OR pg_get_functiondef(oid) ~* 'pgp_sym_encrypt')
  ORDER BY proname`);
console.log('── (1) rrn_enc WRITE 하는 함수 (SET/encrypt) ──');
console.table(rrnWriters.rows);

// ── 2) EXECUTE grant: 각 rrn_enc writer 가 anon 에게 열려있나 ──
for (const w of rrnWriters.rows) {
  const g = await c.query(`
    SELECT r.rolname
    FROM pg_proc p
    JOIN LATERAL aclexplode(p.proacl) a ON true
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.proname = $1 AND p.pronamespace='public'::regnamespace
      AND a.privilege_type='EXECUTE' AND r.rolname IN ('anon','authenticated')`, [w.proname]);
  console.log(`   grant[${w.proname}]:`, g.rows.map(r => r.rolname).join(',') || '(none/public)');
}

// ── 3) 셀프체크인 write 함수들이 birth_date/consent_sensitive/rrn_enc 를 건드리나 ──
const scFns = ['fn_selfcheckin_upsert_customer_resolve_v3','fn_selfcheckin_update_personal_info','fn_selfcheckin_rrn_match'];
console.log('\n── (3) 셀프체크인 write 함수 본문 지문 ──');
for (const fn of scFns) {
  const r = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace LIMIT 1`, [fn]);
  if (!r.rows.length) { console.log(`   ${fn}: (부재)`); continue; }
  const def = r.rows[0].def;
  console.log(`   ${fn}: writes_birth_date=${/birth_date\s*=/.test(def)}  writes_consent_sensitive=${/consent_sensitive\s*=/.test(def)}  touches_rrn_enc=${/rrn_enc/.test(def)}  argcount=${(def.match(/DEFAULT|p_[a-z_]+ /g)||[]).length}`);
}

// ── 4) created_by IS NULL 신규 고객 실분포 (최근 14일) ──
const dist = await c.query(`
  SELECT
    count(*)                                                        AS total_createdby_null,
    count(*) FILTER (WHERE rrn_enc IS NOT NULL)                     AS has_rrn_enc,
    count(*) FILTER (WHERE birth_date IS NOT NULL)                  AS has_birth_date,
    count(*) FILTER (WHERE consent_sensitive IS TRUE)               AS consent_true,
    count(*) FILTER (WHERE rrn_enc IS NOT NULL AND birth_date IS NULL)          AS rrnenc_but_no_birth,
    count(*) FILTER (WHERE rrn_enc IS NOT NULL AND consent_sensitive IS NOT TRUE) AS rrnenc_but_no_consent
  FROM public.customers
  WHERE created_by IS NULL
    AND created_at >= now() - interval '14 days'`);
console.log('\n── (4) created_by IS NULL 신규고객 실분포 (최근14일) ──');
console.table(dist.rows);

// ── 5) rrn_enc 보유 & created_by NULL 표본: rrn_enc write 시각 vs 생성 시각 gap (desk 후입력 신호) ──
const sample = await c.query(`
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::timestamp(0)  AS created_kst,
    (updated_at AT TIME ZONE 'Asia/Seoul')::timestamp(0)  AS updated_kst,
    EXTRACT(EPOCH FROM (updated_at - created_at))::int     AS gap_sec,
    (birth_date IS NOT NULL)        AS has_birth,
    consent_sensitive               AS consent,
    (rrn_enc IS NOT NULL)           AS has_rrn
  FROM public.customers
  WHERE created_by IS NULL AND rrn_enc IS NOT NULL
    AND created_at >= now() - interval '14 days'
  ORDER BY created_at DESC LIMIT 15`);
console.log('\n── (5) rrn_enc 보유 created_by=NULL 표본: 생성→갱신 gap (desk 후입력 신호) ──');
console.table(sample.rows);

await c.end();
console.log('\n✅ probe 완료 (무영속 확인: 위 쿼리 전부 SELECT)');
