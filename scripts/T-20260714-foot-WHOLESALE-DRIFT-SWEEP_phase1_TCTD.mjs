/**
 * T-20260714 WHOLESALE-DRIFT-SWEEP Phase1 — T-C (U-56 idempotency) + T-D (collision-20 reassign) (READ-ONLY)
 * Consumes census JSON. Re-reads U-file SQL for idempotency signatures. No DB write.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const MIG='supabase/migrations';
const census=JSON.parse(readFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_census.json','utf8'));

// ---------- T-C : U-56 idempotency-proof ----------
// U = pending version whose all files are UNKNOWN (no probeable schema objects: data/GRANT/COMMENT/DO)
const U = census.pending.filter(v => v.class==='U');
function idempotencyClass(sql){
  const s=sql.replace(/--[^\n]*/g,' ').replace(/\/\*[\s\S]*?\*\//g,' ');
  const has=(re)=>re.test(s);
  const onlyComment = has(/comment\s+on/i) && !has(/\b(insert|update|delete|grant|revoke)\b/i) && !has(/\bdo\s*\$/i);
  const onlyGrant = has(/\b(grant|revoke)\b/i) && !has(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i) && !has(/\bdo\s*\$/i);
  const hasInsert=has(/insert\s+into/i), hasUpdate=has(/update\s+\w+\s+set/i), hasDelete=has(/delete\s+from/i), hasDO=has(/\bdo\s*\$/i);
  const ocNothing=has(/on\s+conflict[\s\S]{0,60}do\s+nothing/i);
  const ocUpdate=has(/on\s+conflict[\s\S]{0,60}do\s+update/i);
  const pureSeed = hasInsert && !hasUpdate && !hasDelete && !hasDO && ocNothing;
  if(onlyComment) return {cat:'COMMENT-pure', idem:true, verdict:'(A) auto — COMMENT idempotent'};
  if(onlyGrant) return {cat:'GRANT/REVOKE', idem:true, verdict:'(A) auto — GRANT/REVOKE idempotent'};
  if(pureSeed) return {cat:'pure-seed(ON CONFLICT DO NOTHING)', idem:true, verdict:'(A) auto — idempotent seed'};
  // gated
  const tags=[]; if(hasUpdate)tags.push('UPDATE+SET'); if(hasDO)tags.push('DO-block'); if(hasInsert)tags.push('INSERT'); if(hasDelete)tags.push('DELETE'); if(ocUpdate)tags.push('ON-CONFLICT-DO-UPDATE');
  let verdict='수기 idempotency-proof 게이트 (재실행 부작용 가능)';
  if(hasUpdate && !ocNothing) verdict='GATE — UPDATE+SET 재-덮어쓰기 위험. 데이터-정정 성격이면 백필 SOP 경유';
  else if(hasDO) verdict='GATE — DO-block 부수효과. 멱등 확증 전 (A) 금지';
  else if(hasDelete) verdict='GATE — DELETE. 데이터-정정 → 백필/Archive-First SOP';
  return {cat:tags.join('+')||'기타/미상', idem:false, verdict};
}
const tc=[]; const catCount={};
for(const v of U){
  // one version may have multiple files; take representative merge of all its file SQL
  let merged=''; for(const e of v.entries){ merged += '\n' + readFileSync(path.join(MIG,e.file),'utf8'); }
  const ic=idempotencyClass(merged);
  catCount[ic.cat]=(catCount[ic.cat]||0)+1;
  tc.push({version:v.version, files:v.entries.map(e=>e.file), cat:ic.cat, auto_A:ic.idem, verdict:ic.verdict});
}
const tcAuto=tc.filter(x=>x.auto_A), tcGate=tc.filter(x=>!x.auto_A);

// ---------- T-D : collision-20 reassignment ----------
const td=[];
for(const c of census.collisions){
  // determine member materialization: a member "APPLIED" verdict => materialized; UNKNOWN/data => check inLedger
  const members=c.members.map(m=>({file:m.file, verdict:m.verdict, tags:m.tags}));
  const allApplied = members.every(m=>m.verdict==='APPLIED') || c.inLedger && members.every(m=>m.verdict==='APPLIED'||m.verdict==='UNKNOWN');
  const noneApplied = members.every(m=>m.verdict!=='APPLIED');
  let group, action;
  if(members.every(m=>m.verdict==='APPLIED')){ group='ALL-APPLIED'; action='원장 단일행(F, version 기준·collision 무해) → T-A 합류. rename/재실행 금지'; }
  else if(members.some(m=>m.verdict==='APPLIED')){ group='MIXED'; action='APPLIED 멤버=(F) provenance 보존. 미물화 멤버만 14-digit version 재부여(file lane, 원장 무충돌). 재부여≠재-apply'; }
  else { group='NONE-APPLIED'; action='어느 멤버도 미물화 → 미물화 멤버 version 재부여 + 개별 A/X. 재부여가 재-apply 유발 금지(Case J)'; }
  const legacy8 = c.version.length===8;
  td.push({version:c.version, count:c.count, inLedger:c.inLedger, group, legacy8, members, action: legacy8? action+' | 8-digit→14-digit 표준화':action});
}
const tdGroups=td.reduce((a,x)=>(a[x.group]=(a[x.group]||0)+1,a),{});

const out={ticket:'T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP',phase:1,
  TC:{total:U.length, auto_A_count:tcAuto.length, gate_count:tcGate.length, catCount, auto_A:tcAuto, gated:tcGate},
  TD:{total:td.length, groups:tdGroups, items:td}};
writeFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_TCTD.json',JSON.stringify(out,null,2));
console.log('=== T-C U-'+U.length+' idempotency ===');
console.log('auto-(A):',tcAuto.length,'| gated:',tcGate.length);
console.log('cats:',JSON.stringify(catCount,null,1));
console.log('\nauto-(A) versions:'); tcAuto.forEach(x=>console.log('  ',x.version,x.cat));
console.log('\n=== T-D collision-'+td.length+' groups ===',JSON.stringify(tdGroups));
td.forEach(x=>console.log('  ',x.version, `x${x.count}`, x.inLedger?'(L)':'   ', x.group, x.legacy8?'[8dig]':''));
