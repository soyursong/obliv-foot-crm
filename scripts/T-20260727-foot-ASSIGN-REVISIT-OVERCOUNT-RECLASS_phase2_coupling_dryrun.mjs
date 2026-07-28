/**
 * T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — Phase 2 DRY-RUN (READ-ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 * 목적(3):
 *  (A) EDGE #5088 담당축 변경(85ecbec3 consultant 김지윤→강경민)의 `assigned_staff→매출 귀속` 커플링 여부 판정.
 *      - check_ins.consultant_id = 매출귀속 앵커(payments ⋈ check_ins.consultant_id / pkg attr).
 *      - 판정: 85ecbec3(취소 check_in)에 귀속된 payments/packages 존재 여부 → 有=re-gate / 無=순수 배정정정.
 *  (B) 확정 RECLASS/KEEP 대상행 현재 stored 상태 스냅샷(visit_type/consultant_id/status) — freeze 재정합 근거.
 *  (C) owner-forced 충돌 재파생 검증: 정명희(1c2117de) + EDGE-KEEP 3건(9b701267/ebea2e1f/01baf9ea)
 *      의 "이전 done 방문(자기 check_in 시각 기준)" 유무 → 2A 고정경계 recency 재판정 예측.
 *
 * 순수 SELECT only. UPDATE/DDL 0건.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
// EDGE #5088 두 행
const CI_5088_DONE = '9557dec9-530d-44d2-b70d-dc7c52a749ab';   // ① 강경민, done 07-15 15:13 → RECLASS 초진
const CI_5088_CANC = '85ecbec3-0917-4d71-ae06-1993b855714b';   // ② 김지윤, cancelled 07-15 15:09 → RECLASS 초진 + 담당 김지윤→강경민
// owner-forced 충돌 검증 대상
const CI_JMH       = '1c2117de-b091-4227-b8a5-a167c1d865b7';   // 정명희#4270 (KEEP.json, owner-forced 초진 by JMH sibling)
const CI_7137      = '9b701267-3681-4380-a2c9-7dcf9dbec6a2';   // ③ 엄경은 #7137 → KEEP(재진)
const CI_1242      = 'ebea2e1f-a589-47ad-b3e8-c71a0340f513';   // ⑥ 송지현 #1242 → KEEP(재진)
const CI_2601      = '01baf9ea-23e4-4e3f-9ec2-288638eece4b';   // ⑦ 정연주 #2601 → KEEP(재진)
// phase1_5 확정 RECLASS EDGE
const CI_2160      = 'fc8cc7e3-112e-4805-8a96-6cd37a7d1261';   // ④ 정연주 #2160 → RECLASS 초진
const CI_7746      = '71dc0a74-7daf-4468-8300-d3a955368116';   // ⑤ 정연주 #7746 → RECLASS 초진

console.log('=== T-20260727 RECLASS Phase2 DRY-RUN (READ-ONLY) ===\n');

// ── (B) 대상행 현재 stored 상태 스냅샷 ──────────────────────────────
const edgeIds = [CI_5088_DONE, CI_5088_CANC, CI_JMH, CI_7137, CI_1242, CI_2601, CI_2160, CI_7746];
const snap = await q(`
  SELECT ci.id, ci.customer_id, ci.visit_type, ci.status, ci.consultant_id,
         to_char(ci.checked_in_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') AS kst,
         s.name AS consultant_name, ci.deleted_at
  FROM public.check_ins ci
  LEFT JOIN public.staff s ON s.id = ci.consultant_id
  WHERE ci.id IN (${edgeIds.map((x) => `'${x}'`).join(',')})
  ORDER BY ci.checked_in_at;`);
console.log('── (B) EDGE/KEEP 대상행 현재 stored 상태 ──');
console.table(snap.map((r) => ({ id8: r.id.slice(0, 8), cust8: (r.customer_id || '').slice(0, 8), vt: r.visit_type, status: r.status, consultant: r.consultant_name, kst: r.kst, del: r.deleted_at ? 'Y' : '' })));

// ── (A) #5088 취소행(85ecbec3)에 귀속된 매출(payments/packages) 존재 여부 ──
console.log('\n★ (A) EDGE #5088 담당축 변경 — 매출귀속 커플링 판정');
const cust5088 = snap.find((r) => r.id === CI_5088_CANC)?.customer_id;
console.log(`   대상 check_in(취소) = ${CI_5088_CANC.slice(0, 8)} / customer = ${(cust5088 || '?').slice(0, 8)}`);

// A-1: 이 check_in 을 직접 참조하는 payments (check_in_id 컬럼 존재 시)
const payByCi = await q(`
  SELECT count(*)::int AS n, coalesce(sum(amount),0)::bigint AS amt
  FROM public.payments
  WHERE check_in_id = '${CI_5088_CANC}';`).catch((e) => [{ n: 'ERR', amt: String(e.message).slice(0, 60) }]);
console.log(`   A-1 payments.check_in_id='${CI_5088_CANC.slice(0,8)}' → ${JSON.stringify(payByCi[0])}`);

// A-2: 이 취소 check_in 의 consultant_id 를 앵커로 귀속되는 packages (packages.consultant_id 는 생성시점 캡처이나, 앵커가 이 행인지 교차확인)
const pkgAnchor = await q(`
  SELECT count(*)::int AS n
  FROM public.packages p
  WHERE p.customer_id = '${cust5088}' AND p.consultant_id = (SELECT consultant_id FROM public.check_ins WHERE id='${CI_5088_CANC}');`).catch((e) => [{ n: 'ERR:' + String(e.message).slice(0, 50) }]);
console.log(`   A-2 packages(cust #5088, consultant=김지윤 앵커) → ${JSON.stringify(pkgAnchor[0])}`);

// A-3: 취소 check_in 이 매출귀속 조인 대상인가? — 통상 done+consultation 만 앵커. status 확인 + 이 고객 전체 payments 의 귀속 check_in 분포
const payDist = await q(`
  SELECT ci.id = '${CI_5088_CANC}' AS is_target_ci, ci.status, ci.consultant_id IS NOT NULL AS has_consultant,
         count(pm.id)::int AS pay_n, coalesce(sum(pm.amount),0)::bigint AS pay_amt
  FROM public.check_ins ci
  LEFT JOIN public.payments pm ON pm.check_in_id = ci.id
  WHERE ci.customer_id = '${cust5088}'
  GROUP BY 1,2,3 ORDER BY pay_amt DESC;`).catch((e) => [{ err: String(e.message).slice(0, 80) }]);
console.log('   A-3 고객 #5088 payments 귀속 check_in 분포(is_target_ci=취소행 여부):');
console.table(payDist);

// ── (C) owner-forced 충돌 — 2A 고정경계(자기 check_in 시각) 재판정 예측 ──
console.log('\n★ (C) 2A 고정경계 recency 재판정 예측 (자기 check_in 시각 이전 done 방문 유무)');
const conflictIds = [
  ['정명희#4270 (owner-forced 초진)', CI_JMH],
  ['③ #7137 (owner KEEP 재진)', CI_7137],
  ['⑥ #1242 (owner KEEP 재진)', CI_1242],
  ['⑦ #2601 (owner KEEP 재진)', CI_2601],
];
for (const [label, ciId] of conflictIds) {
  const rows = await q(`
    WITH tgt AS (SELECT customer_id, checked_in_at, clinic_id FROM public.check_ins WHERE id='${ciId}')
    SELECT
      (SELECT to_char(checked_in_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') FROM tgt) AS self_kst,
      count(*) FILTER (WHERE ci.status='done')::int AS prior_done,
      count(*) FILTER (WHERE ci.status='cancelled')::int AS prior_cancelled,
      max(to_char(ci.checked_in_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI')) FILTER (WHERE ci.status='done') AS last_prior_done_kst
    FROM public.check_ins ci, tgt
    WHERE ci.customer_id = tgt.customer_id
      AND ci.clinic_id = tgt.clinic_id
      AND ci.deleted_at IS NULL
      AND ci.checked_in_at < tgt.checked_in_at;`);
  const r = rows[0] || {};
  const predict = (r.prior_done > 0) ? 'returning(재진)' : 'new(초진)';
  console.log(`   ${label}: self=${r.self_kst} prior_done=${r.prior_done} prior_cancelled=${r.prior_cancelled} lastDone=${r.last_prior_done_kst || '-'} → 2A예측=${predict}`);
}

console.log('\n✅ DRY-RUN 완료 — UPDATE 0건. 판정은 상단 (A)/(C) 참조.');
