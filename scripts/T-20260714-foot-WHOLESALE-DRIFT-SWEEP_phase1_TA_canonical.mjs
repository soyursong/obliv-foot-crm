/**
 * T-20260714 WHOLESALE-DRIFT-SWEEP Phase1 — T-A refined: canonical-version content-parity (READ-ONLY)
 * Fixes naive-parity false-positives: an object's parity must be judged at its CANONICAL
 * (latest-defining) forward version, not at every superseded redefinition.
 *  - canonical F version whose body == prod  → PASS (supervisor L-1 write candidate)
 *  - canonical F version whose body != prod  → GENUINE DRIFT (supervisor attention, NO write)
 *  - non-canonical (superseded) F version     → F-provenance (parity N/A; older redefinition)
 * SELECT-only bulk snapshot. NO ledger write.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const env=readFileSync('.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const WRITE_RE=/\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment\s+on|do\s*\$|call\s|repair)\b/i;
async function q(sql){ if(WRITE_RE.test(sql)) throw new Error('WRITE_RE');
  for(let a=0;a<8;a++){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
    const t=await r.text(); if(r.status===429){await sleep(2000*(a+1));continue;} if(!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,160)}`); await sleep(200); return JSON.parse(t);} throw new Error('429 exhausted'); }
const MIG='supabase/migrations';
const census=JSON.parse(readFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_census.json','utf8'));

function isForward(f){ if(!f.endsWith('.sql'))return false; if(/\.(rollback|down|dryrun|datafix)\.sql$/i.test(f))return false; if(/_(down|dryrun|rollback)\.sql$/i.test(f))return false; if(/^(rollback_|dedupe_|dummy_|migrate_hfq|visittype_)/i.test(f))return false; return true; }
const versionOf=f=>(f.match(/^(\d{14})/)||f.match(/^(\d{8})/)||[])[1]||null;
// predicate/body normalization: strip casts, collapse parens/space/quotes
function norm(s){ if(s==null)return''; return s.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ')
  .replace(/::[a-z_ ]+(\[\])?/gi,'').replace(/\s+/g,'').replace(/[()"'`]/g,'').replace(/public\./gi,'').toLowerCase(); }
function fileFunctions(sql){ const out={}; const re=/create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\3\$/gi; let m; while((m=re.exec(sql))) out[`${m[1]||'public'}.${m[2]}`]=m[4]; return out; }
function filePolicies(sql){ const out={}; const re=/create\s+policy\s+"?([^"\s]+)"?\s+on\s+(?:\w+\.)?(\w+)([\s\S]*?);/gi; let m; while((m=re.exec(sql))){ const b=m[3]; const u=(b.match(/using\s*\(([\s\S]*?)\)\s*(?:with\s+check|$|;)/i)||[])[1]; const c=(b.match(/with\s+check\s*\(([\s\S]*?)\)\s*;?/i)||[])[1]; out[`${m[2]}::${m[1]}`]={using:u,check:c}; } return out; }

// ---- build canonical-definer index across ALL forward files ----
const files=readdirSync(MIG).filter(isForward).sort(); // ascending version
const canonFn=new Map(), canonPol=new Map(); // obj -> {version, body}
for(const f of files){ const v=versionOf(f); const sql=readFileSync(path.join(MIG,f),'utf8');
  const ff=fileFunctions(sql); for(const k in ff) canonFn.set(k,{version:v,file:f,body:ff[k]}); // later overwrites → latest wins
  const fp=filePolicies(sql); for(const k in fp) canonPol.set(k,{version:v,file:f,...fp[k]}); }

// ---- bulk prod snapshots ----
const prodFn=new Map(); for(const r of await q(`SELECT n.nspname||'.'||p.proname AS fqn, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage');`)) if(!prodFn.has(r.fqn)) prodFn.set(r.fqn,r.prosrc);
const prodPol=new Map(); for(const r of await q(`SELECT tablename||'::'||policyname AS k, qual, with_check FROM pg_policies WHERE schemaname IN ('public','storage');`)) prodPol.set(r.k,r);

// ---- evaluate F versions ----
const F=census.pending.filter(v=>v.class==='F');
const results=[]; let canonPass=0, canonDrift=0, superseded=0, existence=0, phiTag=0;
const MONEY_RE=/(pay|copay|settle|refund|insur|공단|본인부담|정산|수납|매출|revenue|charge|amount|package_session|balance|misu|billing)/i;
for(const v of F){
  const rec={version:v.version, files:v.entries.map(e=>e.file), objs:[], tags:[]};
  let hasBody=false, phi=false, money=false, audit=false;
  for(const e of v.entries){ const sql=readFileSync(path.join(MIG,e.file),'utf8');
    for(const fqn of e.objs.functions){ hasBody=true; if(MONEY_RE.test(fqn)||MONEY_RE.test(sql))money=true;
      const canon=canonFn.get(fqn); const psrc=prodFn.get(fqn);
      if(psrc===undefined){ rec.objs.push({o:`fn:${fqn}`,r:'PROD-ABSENT'}); canonDrift++; continue; }
      if(canon && canon.version!==v.version){ rec.objs.push({o:`fn:${fqn}`,r:`F-provenance (superseded by ${canon.version})`}); superseded++; continue; }
      const eq=norm(fileFunctions(sql)[fqn])===norm(psrc); rec.objs.push({o:`fn:${fqn}`,r:eq?'CANON-PASS':'CANON-DRIFT',money:MONEY_RE.test(fqn)}); eq?canonPass++:canonDrift++; }
    for(const pk of e.objs.policies){ hasBody=true; audit=true;
      const canon=canonPol.get(pk); const prod=prodPol.get(pk);
      if(!prod){ rec.objs.push({o:`pol:${pk}`,r:'PROD-ABSENT (renamed/superseded)'}); canonDrift++; continue; }
      if(canon && canon.version!==v.version){ rec.objs.push({o:`pol:${pk}`,r:`F-provenance (superseded by ${canon.version})`}); superseded++; continue; }
      const fp=filePolicies(sql)[pk]; const uEq=norm(fp?.using)===norm(prod.qual); const cEq=norm(fp?.check)===norm(prod.with_check);
      const ok=uEq&&cEq; rec.objs.push({o:`pol:${pk}`,r:ok?'CANON-PASS':'CANON-DRIFT',uEq,cEq}); ok?canonPass++:canonDrift++; }
    if(/customers|medical_charts|reservations|check_ins|prescription|chart|_memos|treatment|consult|diagnos|rrn|rx_|patient|claims|insurance|phi/i.test(sql)) phi=true;
  }
  if(phi)rec.tags.push('PHI'); if(money)rec.tags.push('MONEY-INVARIANT'); if(audit||/audit|_log|rls/i.test(rec.files.join(''))){rec.tags.push('phi_rls_drift_guard:dual-tag');phiTag++;}
  if(!hasBody){ existence++; rec.parity='EXISTENCE-ONLY'; }
  results.push(rec);
}
const summary={F_versions:F.length, existence_only:existence, canon_PASS:canonPass, canon_DRIFT:canonDrift, superseded_provenance:superseded, phi_rls_dual_tagged:phiTag};
writeFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_TA_canonical.json',JSON.stringify({summary,results},null,2));
console.log(JSON.stringify(summary,null,2));
console.log('\n=== GENUINE canonical-version DRIFT (supervisor attention — NO L-1 write until resolved) ===');
for(const r of results){ const bad=r.objs.filter(o=>/CANON-DRIFT|PROD-ABSENT/.test(o.r)); if(bad.length) console.log(r.version, r.tags.join(','),'::',bad.map(b=>b.o+'='+b.r).join(' | ')); }
