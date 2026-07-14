/**
 * T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC — POST-CLOSE 검증 프로브 (READ-ONLY)
 * 목적: 소스차단 apply(REPRO Phase2, 2026-07-14 10:32:40 KST) 이후 신규 마스킹 유입 0 확증.
 *   - 가드 지문 present(영속 확증) 재확인 + 마스킹 customers row 생성 이력 시간분포.
 * mutation 0. author: dev-foot / planner 2h-PUSH(MSG-20260714-235756-6nsg) 대응.
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function qok(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,1200)}`); return JSON.parse(t); }
const rows = x => x.result ?? x;

const APPLY = '2026-07-14 10:32:40+09';
async function main(){
  console.log('=== POST-CLOSE 검증 (READ-ONLY) — apply 기준선 '+APPLY+' KST ===\n');

  // 1) 가드 영속 확증: helper + 4 RPC 정의에 가드 지문 present
  const helper = rows(await qok(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii';`));
  console.log('1) 가드 영속 (post-probe: prod 함수정의에 가드 지문 present):');
  console.log(`   helper _fn_is_masked_pii n=${helper[0].n} (기대 1)`);
  const guarded = rows(await qok(`
    SELECT p.proname, (pg_get_functiondef(p.oid) ILIKE '%_fn_is_masked_pii%') AS has_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3','self_checkin_create')
    ORDER BY p.proname;`));
  guarded.forEach(g => console.log(`   ${g.has_guard?'✅':'❌'} ${g.proname} guard_present=${g.has_guard}`));

  // 2) 마스킹 customers 생성 시간분포 (apply 전/후)
  const dist = rows(await qok(`
    SELECT
      count(*) FILTER (WHERE created_at <  timestamptz '${APPLY}')::int AS before_apply,
      count(*) FILTER (WHERE created_at >= timestamptz '${APPLY}')::int AS after_apply
    FROM public.customers
    WHERE name ~ '\\*';`));
  console.log('\n2) 마스킹(name에 * 포함) customers 생성 시간분포:');
  console.log(`   apply 이전: ${dist[0].before_apply}건 (기존 오염 → BACKFILL 소관)`);
  console.log(`   apply 이후: ${dist[0].after_apply}건  ← 소스차단 실효 지표 (기대 0)`);

  // 3) apply 이후 신규 마스킹 row 상세 (있으면 소스 미차단)
  const after = rows(await qok(`
    SELECT id, name, phone, created_at
    FROM public.customers
    WHERE name ~ '\\*' AND created_at >= timestamptz '${APPLY}'
    ORDER BY created_at DESC LIMIT 20;`));
  if (after.length===0) console.log('\n3) apply 이후 신규 마스킹 row: 0건 ✅ (소스 닫힘 확증)');
  else { console.log('\n3) ⚠ apply 이후 신규 마스킹 row 발견 (소스 미차단!):'); after.forEach(r=>console.log(`   ${r.created_at} ${r.id} name=${JSON.stringify(r.name)} phone=${JSON.stringify(r.phone)}`)); }

  // 4) 가장 최근 마스킹 row 생성 시각 (최종 오염 시점)
  const last = rows(await qok(`SELECT id, name, created_at FROM public.customers WHERE name ~ '\\*' ORDER BY created_at DESC LIMIT 1;`));
  console.log('\n4) 최종(가장 최근) 마스킹 customers 생성 시각:');
  if (last.length) console.log(`   ${last[0].created_at}  ${last[0].id}  name=${JSON.stringify(last[0].name)}`);
  else console.log('   마스킹 row 없음');

  const closed = helper[0].n===1 && guarded.every(g=>g.has_guard) && dist[0].after_apply===0;
  console.log(`\n=== 판정: 소스 ${closed?'닫힘 확정 ✅ (가드 영속 present + apply 이후 신규 마스킹 0)':'미확정 ⚠'} ===`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
