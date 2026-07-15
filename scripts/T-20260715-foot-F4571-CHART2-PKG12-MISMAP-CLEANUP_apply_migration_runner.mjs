import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return t.trim()?JSON.parse(t):[];}

const sql = readFileSync('supabase/migrations/20260715230000_foot_f4571_pkg12_mismap_archive_cleanup.sql','utf8');
console.log('=== APPLYING DB-GATE GO migration (.sql, atomic txn) ===');
try {
  const res = await q(sql);
  console.log('migration executed. raw result:', JSON.stringify(res));
} catch(e){
  console.log('*** MIGRATION ERROR (rolled back) ***\n', e.message);
  process.exit(1);
}

// ── POSTVERIFY (read-only) ──
const PKG_A='3bde69cb-0dfb-4517-a53d-e9889a7f29b3';
const PP_ALL=['e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650','1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86'];
const lit=a=>a.map(x=>`'${x}'`).join(',');
const post = await q(`SELECT
  (SELECT count(*) FROM _archive_f4571_pkg12_mismap_packages_20260715) archived_pkg,
  (SELECT count(*) FROM _archive_f4571_pkg12_mismap_package_payments_20260715) archived_pp,
  (SELECT count(*) FROM packages WHERE id='${PKG_A}') rem_pkg,
  (SELECT count(*) FROM package_payments WHERE id IN (${lit(PP_ALL)})) rem_pp,
  (SELECT count(*) FROM packages WHERE id='9a553cbd-621b-435e-ae20-aabc035e363e' AND status='active') keep_pkgB,
  (SELECT count(*) FROM package_payments WHERE id='bc58d34e-0ac8-422c-8a83-c8b6000e0a6d') keep_ppB,
  (SELECT count(*) FROM payments WHERE id='01299d6c-d7e1-45bb-894b-ead27c80ac36' AND status='active') keep_trial;`);
const P=post[0];
console.log('\n=== POSTVERIFY ===');
console.log(`  archived: pkg=${P.archived_pkg} pp=${P.archived_pp} (기대 1/4, 합5)`);
console.log(`  freeze remnant: pkg=${P.rem_pkg} pp=${P.rem_pp} (기대 0/0)`);
console.log(`  KEEP intact: pkgB(8회권,active)=${P.keep_pkgB} ppB=${P.keep_ppB} 체험비(active)=${P.keep_trial} (기대 1/1/1)`);
const ok = Number(P.archived_pkg)===1 && Number(P.archived_pp)===4 && Number(P.rem_pkg)===0 && Number(P.rem_pp)===0 && Number(P.keep_pkgB)===1 && Number(P.keep_ppB)===1 && Number(P.keep_trial)===1;
console.log(ok ? '\n  ✅ POSTVERIFY PASS — archived5 / remnant0 / KEEP무손실 / net-loss0.' : '\n  *** POSTVERIFY FAIL ***');
process.exit(ok?0:1);

/* ── APPLY EVIDENCE (2026-07-16, gate3 GO 후 실 apply) ──────────────────────────
 * PREFLIGHT(read-only): C4a/C4b/C4c/C2/C1 전부 PASS (freeze 5행 live, drift 0, KEEP∩freeze=0, children 0).
 * APPLY: supabase/migrations/20260715230000_...archive_cleanup.sql 원자 트랜잭션 실행.
 *   STEP0 idempotency → STEP1 재검증 abort-guard(지문/net0/KEEP-disjoint/blast0) →
 *   STEP2 archive verify(순소실0) → STEP3 DESTRUCTIVE(refund2→payment2→pkg1, rowcount assert) →
 *   STEP4 postverify(freeze 잔존0 + KEEP 무손실). 내부 assert 전량 통과 = commit.
 * POSTVERIFY(read-only): archived pkg=1/pp=4(합5) · freeze remnant=0 · KEEP intact(pkgB active·ppB 1,980,000·체험비 active 10,000).
 * 결과: archived5 / remnant0 / net-loss0 / KEEP untouched. ✅
 * ────────────────────────────────────────────────────────────────────────────── */
