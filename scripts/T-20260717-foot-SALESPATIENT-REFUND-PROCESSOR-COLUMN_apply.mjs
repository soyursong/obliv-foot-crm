/**
 * T-20260717-foot-SALESPATIENT-REFUND-PROCESSOR-COLUMN — PROD APPLY (supervisor)
 *
 * 게이트: supervisor DDL-diff = GO (ADDITIVE, 회귀0) + DA CONSULT-REPLY GO(guv0/cstw, ADDITIVE·조건부 C2 RESOLVED)
 *         + 대표 게이트 면제(autonomy §3.1). dev-foot 최종 핸드오프(라인109): ball=supervisor(prod apply).
 * 배경: FE(commit 967bba3b) 이미 main→CF Pages 라이브, but payments.created_by 미적용
 *        → SalesPatientTab 임베드 쿼리 prod 400(PGRST200) = 라이브 브레이크. apply로 해소.
 *
 * DDL-ATOMIC v1.7 + No-Persistence Protocol:
 *   0) DRY-RUN (BEGIN..assert..ROLLBACK) → DRYRUN-OK + 무영속 post-probe(컬럼 부재 재확인)
 *   1) 멱등 apply (up.sql 자체 BEGIN..COMMIT)
 *   2) 원장 기록 (schema_migrations, ON CONFLICT DO NOTHING)
 *   3) post-apply introspection: col uuid + FK명 payments_created_by_fkey + partial index + RPC created_by=auth.uid()
 *   4) divergence0: FE 임베드 쿼리(processor JOIN) prod 200 재검증
 * author: supervisor / 2026-07-18 · Management API
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260717140000';
const NAME = 'foot_payments_created_by_processor';
const MIG = 'supabase/migrations/20260717140000_foot_payments_created_by_processor.sql';
const DRYRUN = 'supabase/migrations/20260717140000_foot_payments_created_by_processor.dryrun.sql';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
let SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SRK) { try { SRK = (readFileSync('.env.local','utf8').match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}
async function qok(sql){ const r=await q(sql); if(!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0,1500)}`); return JSON.parse(r.body); }
async function restEmbed(){
  const url = `https://${REF}.supabase.co/rest/v1/payments?select=id,processor:user_profiles!payments_created_by_fkey(name)&limit=1`;
  const r = await fetch(url, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  return { status: r.status, body: (await r.text()).slice(0,300) };
}
let pass = true;
const chk=(ok,msg)=>{ console.log(`  ${ok?'✅':'❌'} ${msg}`); pass = ok && pass; };

async function main(){
  console.log('=== T-20260717 SALESPATIENT-REFUND-PROCESSOR-COLUMN PROD APPLY ===\n');

  // ── 0) DRY-RUN (무영속) ──
  console.log('── 0) DRY-RUN (BEGIN..assert..ROLLBACK) ──');
  const dr = await q(readFileSync(DRYRUN,'utf8'));
  chk(dr.ok, `dryrun 실행 → ${dr.ok?'DRYRUN-OK (assert 통과, ROLLBACK 무영속)':'FAIL '+dr.body.slice(0,800)}`);
  if (!dr.ok) { console.log('\n❌ DRYRUN FAIL — apply 중단'); process.exit(1); }
  // 무영속 post-probe: 컬럼 여전히 부재여야 함
  const probe = await qok(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='created_by';`);
  chk((probe.result??probe)[0].n === 0, `무영속 확인: dryrun 후 payments.created_by 여전히 부재 (n=${(probe.result??probe)[0].n})`);
  if (!pass) { console.log('\n❌ 무영속 위반 — apply 중단'); process.exit(1); }

  // ── 1) APPLY ──
  console.log(`\n── 1) APPLY ${MIG} ──`);
  const ap = await q(readFileSync(MIG,'utf8'));
  if (!ap.ok) { console.error(`  ❌ apply 실패 HTTP ${ap.status}: ${ap.body.slice(0,2000)}`); process.exit(1); }
  console.log('  ✅ 마이그 적용 완료 (COMMIT)');

  // ── 2) 원장 기록 ──
  await qok(`INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
             VALUES ('${VERSION}','${NAME}','supervisor:T-20260717-foot-SALESPATIENT-REFUND-PROCESSOR-COLUMN')
             ON CONFLICT (version) DO NOTHING;`);
  const lr = (await qok(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`)).result;
  chk((lr??[]).length === 1, `원장 기록 version=${VERSION}`);

  // ── 3) post-apply introspection ──
  console.log('\n════ POST-APPLY INTROSPECTION ════');
  const col = (await qok(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='created_by';`)).result;
  chk((col??[]).length===1 && col[0].data_type==='uuid', `payments.created_by 영속 (type=${col?.[0]?.data_type})`);
  const fk = (await qok(`SELECT tc.constraint_name, ccu.table_name ref_tbl, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
      WHERE tc.table_name='payments' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='created_by';`)).result;
  const fkrow = (fk??[])[0]||{};
  chk(fkrow.constraint_name==='payments_created_by_fkey' && fkrow.ref_tbl==='user_profiles' && fkrow.delete_rule==='SET NULL',
      `FK payments_created_by_fkey→user_profiles ON DELETE SET NULL (name=${fkrow.constraint_name}, ref=${fkrow.ref_tbl}, del=${fkrow.delete_rule})`);
  const idx = (await qok(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='payments' AND indexname='idx_payments_created_by';`)).result;
  chk((idx??[]).length===1, `partial index idx_payments_created_by 존재`);
  const rpc = (await qok(`SELECT count(*)::int n FROM pg_proc WHERE proname='refund_single_payment' AND prosrc LIKE '%created_by%' AND prosrc LIKE '%auth.uid()%';`)).result;
  chk((rpc??[{n:0}])[0].n>=1, `refund_single_payment 에 created_by=auth.uid() auto-capture 반영`);
  // 역할목록 회귀 없음 (base 20260525050000 확장목록 유지)
  const role = (await qok(`SELECT (prosrc LIKE '%consultant%' AND prosrc LIKE '%coordinator%' AND prosrc LIKE '%therapist%') keep FROM pg_proc WHERE proname='refund_single_payment' LIMIT 1;`)).result;
  chk((role??[{keep:false}])[0].keep===true, `RPC 역할목록 회귀0 (admin/manager/consultant/coordinator/therapist 유지)`);

  // ── 4) divergence0: FE 임베드 쿼리 prod 200 재검증 (schema cache reload 대기) ──
  console.log('\n── 4) FE 임베드 쿼리(processor JOIN) prod 재검증 ──');
  await q(`NOTIFY pgrst, 'reload schema';`);
  let emb;
  for (let i=0;i<6;i++){ await new Promise(r=>setTimeout(r,2500)); emb = await restEmbed(); if (emb.status===200) break; }
  chk(emb.status===200, `SalesPatientTab 임베드 쿼리 prod ${emb.status} ${emb.status===200?'(라이브 브레이크 해소)':emb.body}`);

  console.log('\n════ 결과 ════');
  console.log(pass ? '✅✅ PROD APPLY PASS — 영속·원장·FE쿼리200·divergence0' : '❌ 검증 실패');
  process.exit(pass?0:1);
}
main().catch(e=>{ console.error('FATAL', e); process.exit(1); });
