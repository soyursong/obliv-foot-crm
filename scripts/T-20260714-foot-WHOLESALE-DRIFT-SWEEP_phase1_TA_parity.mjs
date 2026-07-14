/**
 * T-20260714 WHOLESALE-DRIFT-SWEEP Phase1 — T-A: F-198 content-parity 재현 (READ-ONLY)
 * DA Case C3: content-parity = 존재가 아니라 "정의 일치". 함수·돈불변식·PHI 관여 version은
 *   prod 정의(prosrc/pg_policies 본문) == 파일 정의 본문 대조. PASS만 supervisor L-1 단일행 write 후보.
 * RLS/audit 관여 version → phi_rls_drift_guard dual-tag 태깅.
 * SELECT/introspection only. WRITE_RE guard. NO ledger write.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const env=readFileSync('.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
const WRITE_RE=/\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment\s+on|do\s*\$|call\s|repair|refresh\s+materialized|reindex|vacuum|cluster)\b/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function q(sql){ if(WRITE_RE.test(sql)) throw new Error('WRITE_RE: '+sql.slice(0,100));
  for(let attempt=0;attempt<8;attempt++){
    const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
    const t=await r.text();
    if(r.status===429){ await sleep(1500*(attempt+1)); continue; }
    if(!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,160)}`);
    await sleep(120); return JSON.parse(t);
  }
  throw new Error('429 exhausted'); }
const MIG='supabase/migrations';
const census=JSON.parse(readFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_census.json','utf8'));

const PHI_TABLES=/^(customers|medical_charts|reservations|check_ins|prescriptions?|prescription_\w+|chart_\w+|customer_\w+_memos|treatment_\w+|consultations?|consult_\w+|diagnos\w+|rx_\w+|patient_\w+|claims_\w+|insurance_\w+)$/i;
const MONEY_RE=/(pay|copay|settle|refund|insur|gongdan|공단|본인부담|정산|수납|매출|revenue|charge|amount|deposit|package_session|balance|misu|미수|billing|invoice)/i;
const AUDIT_RE=/(audit|_log|rls|policy|grant|attendance)/i;

function norm(s){ return s.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ')
  .replace(/\s+/g,' ').replace(/\s*([(),;=<>])\s*/g,'$1').replace(/'/g,'').replace(/"/g,'').toLowerCase().trim(); }
// extract file function bodies: name -> body between outermost $tag$...$tag$
function fileFunctions(sql){
  const out={}; const re=/create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\3\$/gi; let m;
  while((m=re.exec(sql))){ out[`${m[1]||'public'}.${m[2]}`]=m[4]; } return out;
}
// extract file policy predicates: name -> {using, check}
function filePolicies(sql){
  const out={}; const re=/create\s+policy\s+"?([^"\s]+)"?\s+on\s+(?:\w+\.)?(\w+)([\s\S]*?)(?=create\s+|alter\s+|grant\s+|revoke\s+|comment\s+|;\s*$|$)/gi; let m;
  const src=sql;
  const re2=/create\s+policy\s+"?([^"\s]+)"?\s+on\s+(?:\w+\.)?(\w+)([\s\S]*?);/gi;
  while((m=re2.exec(src))){ const body=m[3]; const u=(body.match(/using\s*\(([\s\S]*?)\)\s*(?:with\s+check|$|;)/i)||[])[1]; const c=(body.match(/with\s+check\s*\(([\s\S]*?)\)\s*;?/i)||[])[1]; out[`${m[2]}::${m[1]}`]={using:u,check:c,table:m[2]}; }
  return out;
}

// ---- BULK prod snapshots (2 queries, avoids per-object throttling) ----
const prodFnRows=await q(`SELECT n.nspname||'.'||p.proname AS fqn, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage');`);
const prodFn=new Map(); for(const r of prodFnRows){ if(!prodFn.has(r.fqn)) prodFn.set(r.fqn, r.prosrc); } // first overload
const prodPolRows=await q(`SELECT tablename||'::'||policyname AS k, qual, with_check, cmd FROM pg_policies WHERE schemaname IN ('public','storage');`);
const prodPol=new Map(); for(const r of prodPolRows){ prodPol.set(r.k, r); }

const F=census.pending.filter(v=>v.class==='F');
const results=[]; let bodyCandidates=0, existenceOnly=0, pass=0, drift=0, phiTag=0;

for(const v of F){
  let merged=''; const fns=new Set(), pols=new Set(), tables=new Set();
  for(const e of v.entries){ const sql=readFileSync(path.join(MIG,e.file),'utf8'); merged+='\n'+sql;
    e.objs.functions.forEach(x=>fns.add(x)); e.objs.policies.forEach(x=>pols.add(x));
    e.objs.tables.forEach(x=>tables.add(x)); Object.values(e.objs.columns).forEach(()=>{});
    e.objs.columns.forEach(c=>tables.add(c.split('.')[0]));
  }
  const rec={version:v.version, files:v.entries.map(e=>e.file), checks:[], tags:[]};
  const hasBody = fns.size>0 || pols.size>0;
  // PHI / audit / money tagging
  const touchesPHI=[...tables,...[...pols].map(p=>p.split('::')[0])].some(t=>PHI_TABLES.test(t));
  const touchesMoney=MONEY_RE.test(merged) || [...fns].some(f=>MONEY_RE.test(f));
  const touchesAudit=pols.size>0 || AUDIT_RE.test(merged);
  if(touchesPHI) rec.tags.push('PHI');
  if(touchesMoney) rec.tags.push('MONEY-INVARIANT');
  if(pols.size>0||touchesAudit) rec.tags.push('phi_rls_drift_guard:dual-tag');
  if(rec.tags.includes('phi_rls_drift_guard:dual-tag')) phiTag++;

  if(!hasBody){ existenceOnly++; rec.parity='EXISTENCE-ONLY (no fn/policy body; census verdict APPLIED — existence parity sufficient)'; results.push(rec); continue; }
  bodyCandidates++;
  const ff=fileFunctions(merged), fp=filePolicies(merged);
  // functions (in-memory compare vs bulk prod snapshot)
  for(const fqn of fns){
    const psrc=prodFn.get(fqn);
    if(psrc===undefined){ rec.checks.push({obj:`fn:${fqn}`, result:'PROD-ABSENT (not F — should be A/X)'}); drift++; continue; }
    const fb=ff[fqn]; if(fb===undefined){ rec.checks.push({obj:`fn:${fqn}`, result:'FILE-BODY-UNPARSED (manual)'}); continue; }
    const eq=norm(fb)===norm(psrc);
    rec.checks.push({obj:`fn:${fqn}`, result: eq?'PASS':'DRIFT', money:MONEY_RE.test(fqn)||MONEY_RE.test(fb)});
    eq?pass++:drift++;
  }
  // policies (in-memory compare vs bulk prod snapshot)
  for(const pkey of pols){
    const prod=prodPol.get(pkey);
    if(!prod){ rec.checks.push({obj:`pol:${pkey}`, result:'PROD-ABSENT (renamed/superseded? not F)'}); drift++; continue; }
    const fpp=fp[pkey];
    if(!fpp){ rec.checks.push({obj:`pol:${pkey}`, result:'FILE-PRED-UNPARSED (manual)'}); continue; }
    const uEq = norm(fpp.using||'')===norm(prod.qual||'') || (!fpp.using&&!prod.qual);
    const cEq = norm(fpp.check||'')===norm(prod.with_check||'') || (!fpp.check&&!prod.with_check);
    const ok=uEq&&cEq;
    rec.checks.push({obj:`pol:${pkey}`, result: ok?'PASS':'DRIFT-PREDICATE', using_match:uEq, check_match:cEq});
    ok?pass++:drift++;
  }
  results.push(rec);
}

const summary={ F_versions:F.length, existence_only:existenceOnly, body_parity_candidates:bodyCandidates,
  obj_checks_PASS:pass, obj_checks_DRIFT:drift, phi_rls_dual_tagged:phiTag };
const out={ticket:'T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP',phase:1,track:'T-A',summary,results};
writeFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_TA.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(summary,null,2));
console.log('\n=== DRIFT / anomalies (need supervisor attention before L-1 write) ===');
for(const r of results){ const bad=r.checks.filter(c=>/DRIFT|ABSENT|UNPARSED/.test(c.result)); if(bad.length) console.log(r.version, r.tags.join(','), '::', bad.map(b=>`${b.obj}=${b.result}`).join(' | ')); }
