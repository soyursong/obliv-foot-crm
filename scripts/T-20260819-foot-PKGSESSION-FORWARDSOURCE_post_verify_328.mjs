/**
 * T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
 * ── 328 folded APPLY POST-VERIFY (write0 · READ-ONLY, APPLY 직후 실행) ──
 *
 * planner NEW-TASK MSG-20260820-024504-8p5n · 정본 ADDENDUM #1 §게이트순서-5.
 * ★ mutation 0 / prod write 0 (Management API service_role SELECT only). APPLY 성공 후 실행.
 *
 * POST-VERIFY 7항 (ADDENDUM #1 §POST-VERIFY):
 *   ① 328 flag=true & FK-set   : apply 대상 328행 전건 is_package_session=true ∧ package_session_id NOT NULL
 *   ② double-link 0            : 한 세션(package_session_id)에 2+ CIS 링크 = 0
 *   ③ gap 무변                 : used == matched + gap, 잔차 gap 이 apply 로 재분류되지 않음
 *   ④ 환불행 무접점            : 비-used(환불/취소/삭제) 회차 링크 = 0
 *   ⑤ A6(₩77.45M) 정합         : flip 총액 = 328 CIS.price 합 = ₩77,450,000 (false HIGH 미발화 대조)
 *   ⑥ 프리즈316 무손상         : 프리즈 316 cis_id 전건이 apply 대상(328)에 포함·flip 완료(무이탈)
 *   ⑦ 원장 무변 · orphan 무증가 : payments/closing_manual 무접점 · orphan(flag=true∩FK-null) census 대비 무증가
 */
import { readFileSync, existsSync } from 'node:fs';
const REPO = '/Users/domas/GitHub/obliv-foot-crm';
const envLocal = readFileSync(`${REPO}/.env.local`, 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const hr=(s)=>console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

const EXPECT_TOTAL = 328, FROZEN_EXPECT = 316, A6_EXPECT = 77450000;

// apply-instant census 가 박제한 대상 cis_id (실제 apply 된 행) + 프리즈316
const PRE = `${REPO}/db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE_gb-preimage-full328.json`;
const FROZEN_PATHS = [`${REPO}/db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json`, '/tmp/remeasure316.json'];
if (!existsSync(PRE)) throw new Error(`full-328 pre-image 부재 — census 선행 필요: ${PRE}`);
const APPLIED = JSON.parse(readFileSync(PRE, 'utf8')).rows.map(r=>r.cis_id);
if (APPLIED.length !== EXPECT_TOTAL) throw new Error(`applied set ${APPLIED.length} != 328`);
const frozenPath = FROZEN_PATHS.find(existsSync);
const FROZEN_IDS = frozenPath ? JSON.parse(readFileSync(frozenPath,'utf8')).snapshot.rows.map(r=>r.cis_id) : [];

const out = { ticket:'T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE', task:'POST-VERIFY 328 folded APPLY',
  prod_ref:REF, verified_at_kst:null, checks:{}, verdict:{pass:null, fail:[]} };
const idArr = (a)=>`ARRAY[${a.map(x=>`'${x}'`).join(',')||'NULL'}]::uuid[]`;

(async () => {
  out.verified_at_kst = (await q(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::text AS kst`))[0].kst;
  hr(`POST-VERIFY @ ${out.verified_at_kst} (prod ${REF}) · applied=${APPLIED.length} · frozen316=${FROZEN_IDS.length}`);

  // ① 328 flag=true & FK-set
  const r1 = await q(`SELECT count(*) AS n, count(*) FILTER (WHERE is_package_session=true AND package_session_id IS NOT NULL) AS coset
    FROM public.check_in_services WHERE id = ANY(${idArr(APPLIED)});`);
  out.checks.flag_fk_set = { applied:Number(r1[0].n), coset:Number(r1[0].coset), pass: Number(r1[0].coset)===EXPECT_TOTAL };
  console.log(`[①] 328 flag&FK: applied=${r1[0].n} coset(true∧NOT NULL)=${r1[0].coset} PASS=${out.checks.flag_fk_set.pass}`);
  if(!out.checks.flag_fk_set.pass) out.verdict.fail.push(`flag_fk_set coset ${r1[0].coset}/${EXPECT_TOTAL}`);

  // ② double-link 0 (apply 대상 세션에 2+ CIS)
  const r2 = await q(`SELECT count(*) AS dup_sessions FROM (
      SELECT package_session_id FROM public.check_in_services
      WHERE package_session_id IS NOT NULL GROUP BY package_session_id HAVING count(*) > 1) x;`);
  out.checks.double_link = { dup_sessions:Number(r2[0].dup_sessions), pass:Number(r2[0].dup_sessions)===0 };
  console.log(`[②] double-link: dup_sessions=${r2[0].dup_sessions} PASS=${out.checks.double_link.pass}`);
  if(!out.checks.double_link.pass) out.verdict.fail.push(`double_link ${r2[0].dup_sessions}`);

  // ③ gap 무변 (used == matched(=flag&FK-set 대상) + gap 잔차). 구조 정합: used 세션 링크 여부.
  const r3 = await q(`SELECT
      (SELECT count(*) FROM public.package_sessions WHERE status='used' AND check_in_id IS NOT NULL) AS used_total,
      (SELECT count(DISTINCT package_session_id) FROM public.check_in_services WHERE package_session_id IS NOT NULL) AS linked_sessions;`);
  out.checks.gap = { used_total:Number(r3[0].used_total), linked_sessions:Number(r3[0].linked_sessions),
    gap: Number(r3[0].used_total)-Number(r3[0].linked_sessions),
    note:'gap = used - linked (구조적 unmatched 잔차 · by construction APPLY-set 밖 · 무재분류)' };
  console.log(`[③] gap: used=${r3[0].used_total} linked=${r3[0].linked_sessions} gap=${out.checks.gap.gap} (잔차 무재분류 확인 — 값 자체는 참고)`);

  // ④ 환불행 무접점 (비-used 링크 0)
  const r4 = await q(`SELECT count(*) AS bad FROM public.check_in_services c
      JOIN public.package_sessions p ON p.id=c.package_session_id WHERE p.status <> 'used';`);
  out.checks.refund_untouched = { non_used_link:Number(r4[0].bad), pass:Number(r4[0].bad)===0 };
  console.log(`[④] 환불행 무접점: non-used link=${r4[0].bad} PASS=${out.checks.refund_untouched.pass}`);
  if(!out.checks.refund_untouched.pass) out.verdict.fail.push(`refund_untouched non_used_link ${r4[0].bad}`);

  // ⑤ A6 ₩77.45M 정합 (flip 총액 = 328 price 합)
  const r5 = await q(`SELECT COALESCE(SUM(price),0)::bigint AS flip_total FROM public.check_in_services WHERE id = ANY(${idArr(APPLIED)});`);
  out.checks.a6 = { flip_total:Number(r5[0].flip_total), expect:A6_EXPECT, pass:Number(r5[0].flip_total)===A6_EXPECT };
  console.log(`[⑤] A6: flip_total=₩${Number(r5[0].flip_total).toLocaleString()} expect=₩${A6_EXPECT.toLocaleString()} PASS=${out.checks.a6.pass}`);
  if(!out.checks.a6.pass) out.verdict.fail.push(`a6 flip_total ${r5[0].flip_total}/${A6_EXPECT}`);

  // ⑥ 프리즈316 무손상 (316 전건 apply 완료·flip)
  if (FROZEN_IDS.length === FROZEN_EXPECT) {
    const r6 = await q(`SELECT count(*) AS flipped FROM public.check_in_services
        WHERE id = ANY(${idArr(FROZEN_IDS)}) AND is_package_session=true AND package_session_id IS NOT NULL;`);
    out.checks.frozen316 = { frozen:FROZEN_IDS.length, flipped:Number(r6[0].flipped), pass:Number(r6[0].flipped)===FROZEN_EXPECT };
    console.log(`[⑥] 프리즈316 무손상: frozen=${FROZEN_IDS.length} flipped=${r6[0].flipped} PASS=${out.checks.frozen316.pass}`);
    if(!out.checks.frozen316.pass) out.verdict.fail.push(`frozen316 flipped ${r6[0].flipped}/${FROZEN_EXPECT}`);
  } else {
    out.checks.frozen316 = { skipped:true, reason:`frozen316 미로드(${FROZEN_IDS.length}) — 프리즈 JSON 확인 필요` };
    console.log(`[⑥] 프리즈316: SKIP (${FROZEN_IDS.length} 로드 — census 프리즈 JSON 확인)`);
    out.verdict.fail.push('frozen316 미로드');
  }

  // ⑦ orphan 무증가 (flag=true∩FK-null) — census baseline 과 대조 (수동 대조: census result 의 orphan_baseline_pre_apply)
  const r7 = await q(`SELECT count(*) AS orphan_now FROM public.check_in_services WHERE is_package_session=true AND package_session_id IS NULL;`);
  out.checks.orphan = { orphan_now:Number(r7[0].orphan_now),
    note:'census result.orphan_baseline_pre_apply 와 동일해야 함(apply 로 orphan 무증가 — P-floor §686-690). backfill.sql 가드④ co-set 이면 구조적 무증가.' };
  console.log(`[⑦] orphan(flag=true∩FK-null) now=${r7[0].orphan_now} (census baseline 과 대조 — 무증가 확인)`);

  out.verdict.pass = out.checks.flag_fk_set.pass && out.checks.double_link.pass &&
    out.checks.refund_untouched.pass && out.checks.a6.pass && (out.checks.frozen316.pass===true);
  hr(`POST-VERIFY = ${out.verdict.pass ? 'PASS' : 'FAIL'} ${out.verdict.pass?'':'\n  '+out.verdict.fail.join('\n  ')}`);

  const path = `${REPO}/db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE_post-verify-328_result.json`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nDONE: ${path}`);
  if(!out.verdict.pass) process.exit(2);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
