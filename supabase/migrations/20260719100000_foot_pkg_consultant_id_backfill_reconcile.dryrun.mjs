/**
 * T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE — 백필 RECONCILE DRY-RUN (READ-ONLY)
 *
 * 목적: Phase 1 백필(20260718241000, heuristic pkg_attr 스냅샷 fill 119건)이
 *   authoritative DA 결정문(da_decision_foot_pkg_consultant_id_attr_capture_20260718.md, Q4)의
 *   "heuristic-launder 반려 · 결정적 링크(check_ins.package_id=packages.id)만 fact 백필" 과 배치됨.
 *   → 결정문에 정합하도록 컬럼을 재수렴: 결정적링크분만 fact, 나머지 전부 NULL(read-time COALESCE 폴백).
 *
 * ⚠ SELECT만. write 0. non-persistence.
 * 실행: node supabase/migrations/20260719100000_foot_pkg_consultant_id_backfill_reconcile.dryrun.mjs
 *
 * 산출(결정문 §Q4 dry-run 요구 + data_correction_backfill_sop):
 *   ① 전체 count / 현재 컬럼상태(filled/null)
 *   ② 결정적링크 백필대상 count (fact UPDATE 대상) + 값
 *   ③ NULL-유지 count (by-design, read-time 폴백)
 *   + freeze 대상셋(revert→NULL 목록 / det-fix 목록) + delta 매출영향 + pre/post-probe(무영속)
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(readFileSync(ENV,'utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const won = (n)=> n==null?'-':Number(n).toLocaleString('ko-KR');
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const DET_CTE = `
  det AS (
    SELECT DISTINCT p.id AS package_id, ci.consultant_id AS det_consultant
    FROM packages p JOIN check_ins ci ON ci.package_id = p.id
    WHERE p.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL
  )`;

console.log('════ RECONCILE DRY-RUN (read-only, non-persistence) ════\n');

// pre-probe
const pre = (await q(`SELECT
  (SELECT COUNT(*) FROM packages WHERE clinic_id='${CLINIC}') AS total,
  (SELECT COUNT(*) FROM packages WHERE clinic_id='${CLINIC}' AND consultant_id IS NOT NULL) AS filled,
  (SELECT COUNT(*) FROM packages WHERE clinic_id='${CLINIC}' AND consultant_id IS NULL) AS nul`))[0];
console.log('[PRE-PROBE] total=%s filled=%s null=%s', pre.total, pre.filled, pre.nul);

// ② 결정적링크 대상 (fact UPDATE 대상)
const det = await q(`WITH ${DET_CTE}
  SELECT d.package_id, d.det_consultant, s.name AS det_name,
         p.consultant_id AS cur_col, sc.name AS cur_name, p.total_amount
  FROM det d JOIN packages p ON p.id=d.package_id
  LEFT JOIN staff s ON s.id=d.det_consultant
  LEFT JOIN staff sc ON sc.id=p.consultant_id
  ORDER BY d.package_id`);
console.log('\n② 결정적링크 백필대상 (fact) = %d건', det.length);
for(const r of det) console.log('   pkg=%s  det=%s(%s)  현재컬럼=%s(%s)  amt=%s  %s',
  r.package_id.slice(0,8), (r.det_consultant||'').slice(0,8), r.det_name,
  (r.cur_col||'NULL').slice(0,8), r.cur_name||'-', won(r.total_amount),
  r.cur_col===r.det_consultant?'(일치)':'★불일치→det로 정정');

// ① revert 대상 (현재 filled 이나 det 링크 없음 → NULL 복원)
const revert = await q(`WITH ${DET_CTE}
  SELECT COUNT(*) AS cnt, COALESCE(SUM(p.total_amount),0) AS amt
  FROM packages p
  WHERE p.clinic_id='${CLINIC}' AND p.consultant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM det d WHERE d.package_id=p.id)`);
console.log('\n① heuristic-launder revert→NULL 대상 = %s건 (매출 %s원)', revert[0].cnt, won(revert[0].amt));

// ③ NULL 유지 count (revert 후 최종 NULL)
console.log('\n③ 최종 NULL-유지(by-design, read-time COALESCE 폴백) = %d건', pre.total - det.length);

// post-probe SIMULATION (무영속: 실제 UPDATE 안 함, 예측만)
console.log('\n[POST-PROBE 예측(무영속)] filled=%d (=결정적링크 %d) / null=%d',
  det.length, det.length, pre.total - det.length);
console.log('   ※ 실제 write 0. 위는 reconcile 적용 시 예상 종단상태.');

// freeze 스냅샷 (revert 대상 package_id 목록)
const freeze = await q(`WITH ${DET_CTE}
  SELECT p.id FROM packages p
  WHERE p.clinic_id='${CLINIC}' AND p.consultant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM det d WHERE d.package_id=p.id)
  ORDER BY p.id`);
console.log('\n[FREEZE] revert-set size=%d (판정근거 스냅샷)', freeze.length);
console.log('   revert_ids_head:', freeze.slice(0,5).map(r=>r.id.slice(0,8)).join(','), '...');
console.log('   det_fix_ids:', det.map(r=>r.package_id.slice(0,8)).join(','));

console.log('\n════ SUMMARY: revert %s → NULL, det-fix %d, 최종 filled=%d/null=%d ════',
  revert[0].cnt, det.length, det.length, pre.total-det.length);
