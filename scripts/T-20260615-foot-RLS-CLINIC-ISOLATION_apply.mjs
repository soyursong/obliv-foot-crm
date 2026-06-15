/**
 * T-20260615-foot-RLS-CLINIC-ISOLATION — Phase1(160000) + Phase2a(170000) PROD APPLY
 * supervisor FIX-REQUEST(MSG-20260615-230604-huju): db_not_applied → dev-foot 직접 실행.
 *   policy: "dev-foot DB 마이그레이션 직접 실행"(대시보드 수동 금지).
 * 흐름: PRE introspect(READ-ONLY) → Phase1 apply(자체 BEGIN/COMMIT+DO 가드) →
 *       Phase2a apply(additive) → NOTIFY pgrst → POST introspect + 자동 검증(PASS/FAIL).
 * 증빙: evidence/..._preapply_<ts>.txt / ..._postapply_<ts>.txt
 */
import pg from 'pg';
import fs from 'fs';
const ROOT = process.env.HOME + '/Documents/GitHub/obliv-foot-crm';
let P = process.env.SUPABASE_DB_PASSWORD;
for (const l of fs.readFileSync(ROOT + '/.env', 'utf8').split('\n')) {
  const m = l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) P = m[1].trim();
}
const TABLES = ['customers', 'check_ins', 'reservations', 'payments'];
const RPCS = ['fn_selfcheckin_reservation_banner','fn_selfcheckin_find_customer',
  'fn_selfcheckin_existing_checkin_today','fn_selfcheckin_match_reservation',
  'fn_selfcheckin_linked_checkin','fn_selfcheckin_upsert_customer','fn_selfcheckin_create_check_in'];
const TS = new Date().toISOString().replace(/[:.]/g,'').replace('T','T').slice(0,15) + 'Z';

const c = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432,
  database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });

async function introspect(client, label) {
  let out = `=== ${label}  ${new Date().toISOString()} ===\n`;
  const pol = await client.query(
    `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
       FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1)
      ORDER BY tablename, cmd, policyname`, [TABLES]);
  const hasClinic = (s) => /current_user_clinic_id\(\)/.test(s||'');
  let cur='', anonRead=0, noClinic=0;
  for (const r of pol.rows) {
    if (r.tablename!==cur){ cur=r.tablename; out+=`\n-- ${cur} --\n`; }
    out += `  [${r.cmd}] ${r.policyname} roles=${r.roles}\n`;
    if (r.qual) out += `     USING: ${(r.qual||'').replace(/\s+/g,' ')}\n`;
    if (r.with_check) out += `     CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}\n`;
    const isAnon = /\banon\b/.test(r.roles);
    if (isAnon && (r.cmd==='SELECT' || (r.qual||'').trim()==='true')) anonRead++;
    else if (!isAnon && !hasClinic(r.qual) && !hasClinic(r.with_check)) noClinic++;
  }
  out += `\n[diag] authenticated clinic-술어 부재 = ${noClinic}건, anon 직접 SELECT/USING(true) = ${anonRead}건\n`;
  // rrn_decrypt 시그니처 + 본문 게이트 + EXECUTE grant
  const rrn = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def, p.prosecdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='rrn_decrypt'`);
  const def = rrn.rows[0]?.def || '';
  const hasAdminGate = /is_admin_or_manager\(\)/.test(def);
  const hasClinicGate = /current_user_clinic_id\(\)/.test(def);
  const hasSearchPath = /search_path/i.test(def);
  out += `\n[rrn_decrypt] SECURITY ${rrn.rows[0]?.prosecdef?'DEFINER':'INVOKER'} | admin게이트=${hasAdminGate} | clinic게이트=${hasClinicGate} | search_path고정=${hasSearchPath}\n`;
  // RPC 존재 + anon EXECUTE + 반환타입(zero-PII C1 근거)
  const fns = await client.query(
    `SELECT p.proname, pg_get_function_result(p.oid) AS ret, p.prosecdef,
            EXISTS(SELECT 1 FROM information_schema.routine_privileges rp
                    WHERE rp.routine_schema='public' AND rp.routine_name=p.proname AND rp.grantee='anon') AS anon_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname = ANY($1) ORDER BY p.proname`, [RPCS]);
  out += `\n[RPC 7종] (존재 ${fns.rows.length}/7)\n`;
  for (const f of fns.rows)
    out += `  ${f.proname}  ret=${(f.ret||'').replace(/\s+/g,' ')}  secdef=${f.prosecdef}  anon_exec=${f.anon_exec}\n`;
  return { out, noClinic, anonRead, rpcCount: fns.rows.length, rrnAdminGate: hasAdminGate, rrnClinicGate: hasClinicGate, rrnSearchPath: hasSearchPath, rpcs: fns.rows };
}

await c.connect();
console.log(`✅ PROD 연결 ${new Date().toISOString()}\n`);

// ── PRE ────────────────────────────────────────────────────────────────────
const pre = await introspect(c, 'PRE-APPLY (READ-ONLY)');
const preFile = `${ROOT}/evidence/T-20260615-foot-RLS-CLINIC-ISOLATION_preapply_${TS}.txt`;
fs.writeFileSync(preFile, pre.out);
console.log(`📄 PRE 증빙 저장: ${preFile}`);
console.log(`   PRE: clinic술어부재=${pre.noClinic}, anon직접=${pre.anonRead}, RPC=${pre.rpcCount}/7, rrn(admin/clinic/sp)=${pre.rrnAdminGate}/${pre.rrnClinicGate}/${pre.rrnSearchPath}`);

// ── APPLY Phase 1 ────────────────────────────────────────────────────────────
const p1 = fs.readFileSync(`${ROOT}/supabase/migrations/20260615160000_rls_clinic_isolation_patient_tables.sql`,'utf8');
console.log('\n▶ Phase 1 (160000) 적용… (파일 자체 BEGIN/COMMIT + DO 가드)');
try { await c.query(p1); console.log('✅ Phase 1 COMMIT 완료'); }
catch(e){ console.error('❌ Phase 1 실패:', e.message); await c.end(); process.exit(1); }

// ── APPLY Phase 2a ───────────────────────────────────────────────────────────
const p2a = fs.readFileSync(`${ROOT}/supabase/migrations/20260615170000_rls_clinic_isolation_anon_rpc_additive.sql`,'utf8');
console.log('\n▶ Phase 2a (170000) 적용… (additive: RPC 7종 + anon GRANT)');
try { await c.query(p2a); console.log('✅ Phase 2a COMMIT 완료'); }
catch(e){ console.error('❌ Phase 2a 실패:', e.message); console.error('⚠ Phase1은 이미 적용됨 — rollback 필요 시 160000_*.rollback.sql'); await c.end(); process.exit(1); }

await c.query("NOTIFY pgrst, 'reload schema'");
console.log('🔔 NOTIFY pgrst reload schema 발행');

// ── POST ─────────────────────────────────────────────────────────────────────
const post = await introspect(c, 'POST-APPLY');
const postFile = `${ROOT}/evidence/T-20260615-foot-RLS-CLINIC-ISOLATION_postapply_${TS}.txt`;
fs.writeFileSync(postFile, post.out);
console.log(`\n📄 POST 증빙 저장: ${postFile}`);

// ── 자동 검증 (PASS/FAIL) ──────────────────────────────────────────────────────
const checks = [
  ['AC1 authenticated clinic 술어 부재 0건', post.noClinic === 0],
  ['AC2-2a RPC 7종 prod 생성', post.rpcCount === 7],
  ['AC2-2a RPC 7종 anon EXECUTE 부여', post.rpcs.every(f=>f.anon_exec)],
  ['AC2-2a RPC 전부 SECURITY DEFINER', post.rpcs.every(f=>f.prosecdef)],
  ['AC3 rrn_decrypt admin 게이트', post.rrnAdminGate],
  ['AC3 rrn_decrypt clinic 게이트', post.rrnClinicGate],
  ['CONSULT Q3 rrn_decrypt search_path 고정', post.rrnSearchPath],
  ['2b HOLD: anon 직접 SELECT 잔존(의도)', post.anonRead > 0],
];
console.log('\n═══ 자동 검증 ═══');
let allPass = true;
for (const [name, ok] of checks){ console.log(`  ${ok?'✅':'❌'} ${name}`); if(!ok) allPass=false; }
console.log(`\n${allPass?'🟢 ALL PASS':'🔴 FAIL 존재'} — POST: clinic술어부재=${post.noClinic}, anon직접=${post.anonRead}, RPC=${post.rpcCount}/7`);

await c.end();
process.exit(allPass ? 0 : 2);
