/** DIAG probe2 — READ-ONLY. birth_date 미저장 근인 정밀 조사. */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')) { const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if(m) DB_PASSWORD=m[1].trim(); }
const c = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false} });
await c.connect();

// A) update_personal_info 오버로드 전수 + 각 birth_date 파라미터 존재/배정 라인
const ov = await c.query(`
  SELECT oid, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc WHERE proname='fn_selfcheckin_update_personal_info' AND pronamespace='public'::regnamespace`);
console.log('── (A) update_personal_info 오버로드 수:', ov.rows.length);
for (const r of ov.rows) {
  const def = (await c.query(`SELECT pg_get_functiondef($1::oid) AS d`, [r.oid])).rows[0].d;
  const hasParam = /p_birth_date/.test(def);
  const bdLine = (def.split('\n').find(l => /birth_date\s*=/.test(l)) || '(none)').trim();
  const csLine = (def.split('\n').find(l => /consent_sensitive\s*=/.test(l)) || '(none)').trim();
  console.log(`   [oid ${r.oid}] argN=${r.args.split(',').length} p_birth_date_param=${hasParam}`);
  console.log(`      birth_date 배정 : ${bdLine}`);
  console.log(`      consent 배정    : ${csLine}`);
}

// B) resolve_v3 오버로드 + birth_date INSERT/UPDATE 라인
const ov2 = await c.query(`SELECT oid, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='fn_selfcheckin_upsert_customer_resolve_v3' AND pronamespace='public'::regnamespace`);
console.log('\n── (B) resolve_v3 오버로드 수:', ov2.rows.length);
for (const r of ov2.rows) {
  const def = (await c.query(`SELECT pg_get_functiondef($1::oid) AS d`, [r.oid])).rows[0].d;
  console.log(`   [oid ${r.oid}] argN=${r.args.split(',').length} p_birth_date_param=${/p_birth_date/.test(def)}`);
  def.split('\n').filter(l=>/birth_date/.test(l)).forEach(l=>console.log('      | '+l.trim()));
}

// C) customers 테이블 birth_date 컬럼 타입 + birth_date 를 건드리는 트리거
const col = await c.query(`SELECT data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='customers' AND column_name='birth_date'`);
console.log('\n── (C) customers.birth_date 컬럼:', JSON.stringify(col.rows[0]));
const trg = await c.query(`
  SELECT t.tgname, p.proname, (pg_get_functiondef(p.oid) ~* 'birth_date') AS touches_birth_date
  FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid='public.customers'::regclass AND NOT t.tgisinternal`);
console.log('   customers 트리거:'); console.table(trg.rows);

// D) 신규 created_by=NULL 중 birth_date NOT NULL 이 정말 0인지 (전체기간, 안전재확인)
const z = await c.query(`SELECT count(*) total, count(*) FILTER (WHERE birth_date IS NOT NULL) has_bd FROM public.customers WHERE created_by IS NULL`);
console.log('\n── (D) created_by=NULL 전체:', JSON.stringify(z.rows[0]));
// 대조: created_by NOT NULL(직원생성) 은 birth_date 저장되나?
const z2 = await c.query(`SELECT count(*) total, count(*) FILTER (WHERE birth_date IS NOT NULL) has_bd FROM public.customers WHERE created_by IS NOT NULL`);
console.log('   대조 created_by NOT NULL:', JSON.stringify(z2.rows[0]));

// E) 방문유형별 created_by=NULL 분포 (new 만 rrn 수집) + 그중 birth/consent
const vt = await c.query(`
  SELECT visit_type,
         count(*) total,
         count(*) FILTER (WHERE birth_date IS NOT NULL) has_bd,
         count(*) FILTER (WHERE consent_sensitive IS TRUE) consent_true,
         count(*) FILTER (WHERE rrn_enc IS NOT NULL) has_rrn
  FROM public.customers WHERE created_by IS NULL AND created_at >= now()-interval '14 days'
  GROUP BY visit_type ORDER BY total DESC`);
console.log('\n── (E) created_by=NULL 방문유형별 (최근14일) ──'); console.table(vt.rows);

await c.end();
