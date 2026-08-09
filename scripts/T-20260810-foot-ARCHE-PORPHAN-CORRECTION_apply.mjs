/**
 * T-20260810-foot-ARCHE-PORPHAN-CORRECTION — 회차권 P-orphan 재-결선 correction (Leg-A 단독)
 * ---------------------------------------------------------------------------------------------
 * WHAT: check_in_services.is_package_session=true ∩ package_session_id IS NULL = 62 P-orphan 을
 *       foot-native exact-anchor 로 fill-on-NULL FK 재-결선(Leg-A). 매출/원장 무접촉(G4 by-construction).
 *
 * GATES (모두 선행 확인됨):
 *   - DA CONSULT-REPLY MSG-20260810-015024-v8dg · da_decision_foot_arche_porphan_correction_spec_20260810.md
 *     verdict=조건부 GO · db_change=false(정정=INSERT-of-FK 재-결선·reversible·DDL 0·매출축 무접촉).
 *   - Q5 forward-seal FORENSIC = H1(seal) — evidence/..._forensic_seal_result.md (commit edc447d5).
 *   - ★prod apply 는 supervisor DB-GATE GO-token 발행 후에만 (apply_before_go 금지).
 *
 * 분류 (census evidence/..._census_result.md, freeze 62):
 *   - A (resolvable) = 28 : exact-anchor 유일확정 → auto fill-on-NULL (preserve-on-non-NULL)
 *   - B (ambiguous)  = 0  : 후보 ≥2 (없음)
 *   - B (absent)     = 34 : 매칭 package_session 부재 → ★재-결선 대상 아님. 현장확정 라우팅
 *                           (다수 테스트/더미고객 test-data void). 본 스크립트는 절대 손대지 않음.
 *
 * exact-anchor (Leg-A · DETERMINISTIC · fill-on-NULL · preserve-on-non-NULL):
 *   target ps = package_sessions WHERE ps.check_in_id = cis.check_in_id      -- foot-native 방문 anchor
 *                                   ∩ ps.package_id ∈ (동일 customer 의 packages)
 *                                   ∩ ps.session_type = map(cis.service_name)
 *                                   ∩ ps.deleted_at IS NULL
 *                                   ∩ NOT claimed (healthy overwrite 방지)
 *               → 유일확정(정확히 1건)일 때만 auto-link.
 *
 * MODES:
 *   (default) --dry-run  : SELECT-only. no-persistence BY CONSTRUCTION (UPDATE 미발행).
 *                          freeze-set 재검증 → plan 계산 → 판정근거 스냅샷 + before-image + rollback SQL
 *                          → counterfactual POSTCHECK 불변식 검증. ZERO prod write.
 *   --apply              : A-resolvable 행에 fill-on-NULL UPDATE. HARD-GATED:
 *                          db-gate/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_GO.token.json(+.sig) 실재
 *                          AND --i-have-go-token 명시 없으면 REFUSE.
 *                          per-row 가드(is_package_session=true ∩ package_session_id IS NULL) →
 *                          money-field 무접촉 · B-absent 무접촉 · apply 직전 freeze 재검증(신규 orphan → abort).
 *
 * 정정 원칙 (Data-Correction Backfill SOP 준용, DA 확정: db_change=false·mutable UPDATE 봉투 축약형):
 *   단일 count 기준 blanket UPDATE 금지 · exact-anchor 지문 · 대상셋 freeze · 판정근거 스냅샷 동봉 ·
 *   under-correct ≫ over-correct · before-image reversibility.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REPO = '/Users/domas/GitHub/obliv-foot-crm';
const REF = 'rxlomoozakkjesdqjtvd';
const TICKET = 'T-20260810-foot-ARCHE-PORPHAN-CORRECTION';
const GO_TOKEN = `${REPO}/db-gate/${TICKET}_GO.token.json`;
const GO_TOKEN_SIG = `${REPO}/db-gate/${TICKET}_GO.token.sig`;
const SNAPSHOT_OUT = `${REPO}/evidence/${TICKET}_apply_snapshot.json`;

const env = readFileSync(`${REPO}/.env.local`, 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!tok) { console.error('FATAL: no SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1); }

const ARGS = new Set(process.argv.slice(2));
const MODE_APPLY = ARGS.has('--apply');
const HAS_GO_FLAG = ARGS.has('--i-have-go-token');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// ── freeze-set: 62 P-orphan cis_pk (census SSOT scalp2-CROSSFORK-CENSUS_foot_result.md §(2)) ──
const FREEZE_62 = [
  '5d55c4da-9033-48b2-b277-7bc81af5a1ad','e8b692bb-17ca-4e29-ac61-7f1b55482a25',
  '196c54db-17c2-48b0-8818-ed2d0a844518','afa1997d-b048-4d59-947c-b93f25320507',
  'aad454d5-7104-452b-9267-efeb051c6d07','18ea0df8-03f3-42a8-978a-1c6be3457935',
  'a0cbc4ef-bf11-4cc9-af4a-e123ad117598','8fea9012-a0e6-4b99-b2e8-ee4099d0ce19',
  '5c2f69b0-4dc7-4d28-9167-980fccd3dcb8','9e0bb3ee-6ff1-48f5-93a2-65fdeb85079a',
  'df4310f7-3872-4243-963d-0097100d5bbe','e28dffa5-2262-4825-acc2-df2c26b56eaf',
  '0e8f84c8-29b9-4d8f-96b2-7bf8fb076eb6','ecd6cb45-64f9-4cfe-8e7c-42b22aea3bc3',
  '1a14c169-f53b-434b-85b0-5272df93b117','a629e0dc-1f30-403f-8814-80258a074038',
  '261d6aad-8cb2-4767-8170-dcc288e28c09','b4959728-a6f4-4803-89d9-7a3d77508f64',
  'c3125286-638b-4463-859b-34ecaf4ee79f','76b533ad-2218-4871-829a-302a701456c5',
  '8282bb19-5038-48d4-a4a4-580bc1f6e195','72d97156-5a80-4ca4-ac5d-cacb9ac40b8d',
  'bdc08d55-5d36-40f9-9e45-43f1dd155ad4','745ddfeb-1814-4c3f-bf33-4f736aac0212',
  '40fbd98b-439e-433d-8c1e-31eb164c7c30','8cdbb847-1c03-480f-bdfa-98ea98c28423',
  '4299825e-34e2-4528-a832-cbf18ec96ca3','c88e80c2-4789-4a2d-886e-ac1f87cfc327',
  'fa4e86d0-b951-4eb4-a298-9f405d730539','eb1d0547-c1b5-4576-9cb3-8cdaf79c7630',
  '142521aa-5fb2-42db-ac9e-0145b0db6454','fcda8bce-60de-422f-b133-7823250e1a17',
  '750b1ff5-ece7-41c8-99f0-db4f4f5fa54d','cf6a393b-b2df-4879-8306-1997a5dd652d',
  '2554fc9d-f466-4d61-9e6a-49f7a21b7107','e34098c4-65ef-41b0-8848-83d1d9ad4d08',
  '7fd08361-2d77-4806-b217-a6694158f226','89443cb7-00c3-45f3-afbd-835f674cb831',
  '144d1c1d-5be2-4a8a-b4ca-1e7799bfdef7','e83e5b38-cb7b-447e-8485-7f39e6e16984',
  'a2aecc90-1f0f-43d5-bc37-d12cd3698ade','82f8c4c2-5d60-4f4e-bc27-4cc3a1589cef',
  '6d54c7b0-a0e6-4ed0-8f33-84e377bd76d1','b0425810-070a-4261-b1d1-17c228ecca97',
  '65f933b1-ba6c-499c-9414-e11ebafab706','74ac3114-65c7-44fe-95cc-0064103c6b32',
  '40c9f75f-b040-4bb8-b557-8a8387e82f2d','a01387a5-2235-4c4f-9509-23eb590cd09a',
  'ea0bb2ec-11a4-4cb8-af5e-4db2eb7ee1a7','333132e9-3970-443f-9573-99f79556c179',
  '78a9c656-5278-4724-a7f1-09d64db62ec6','57d33389-242c-4bbd-8b73-03ae431c9c15',
  'ae8fcdb3-2fc8-49d4-8d18-a6ba37ff9a10','7501b833-564c-43e8-a6a0-f83bc5963ad9',
  'c06fbe1d-4340-4150-bcd5-b40a9d4c57d2','a91e44d6-6a47-4296-be40-e0073cd4e230',
  '26eced41-63cb-469d-ba10-0cd41ae55be5','9cc2cf34-7e24-4d0e-86d9-4bf36911e4b9',
  '1616ed7c-208f-42e0-8681-3e42b52cf3ee','fab971a7-2160-4691-91aa-500ad2253bef',
  '17509664-422b-4a96-9b4a-306247b08133','4a739550-4ed3-4211-bd9e-8f04a1aa60b2',
];
// AF-2 caveat rows (Q-B): '비가열레이저 - AF' 신규명 매핑근거 약함 → apply per-row 확인 flag.
const AF_CAVEAT = new Set(['89443cb7-00c3-45f3-afbd-835f674cb831','ae8fcdb3-2fc8-49d4-8d18-a6ba37ff9a10']);

// ── plan CTE: 62 orphan 을 exact-anchor 로 partition + resolvable 의 유일 ps 확정 ──
const PLAN_SQL = `
  WITH map AS (SELECT * FROM (VALUES
      ('비가열성 진균증 레이저 치료','unheated_laser'),
      ('가열성 진균증 레이저 치료','heated_laser'),
      ('포돌로게(내성발톱 치료의료기기)','podologue'),
      ('비가열레이저 - AF','unheated_laser')) AS m(service_name, session_type)),
  orphans AS (
    SELECT cis.id AS cis_pk, cis.check_in_id, cis.service_name,
           cis.price, cis.original_price, ci.customer_id,
           (SELECT session_type FROM map WHERE map.service_name = cis.service_name) AS mapped_st
    FROM check_in_services cis JOIN check_ins ci ON ci.id = cis.check_in_id
    WHERE cis.is_package_session = true AND cis.package_session_id IS NULL),
  cand AS (
    SELECT o.cis_pk, ps.id AS ps_id, ps.status,
           EXISTS(SELECT 1 FROM check_in_services c2 WHERE c2.package_session_id = ps.id) AS ps_claimed
    FROM orphans o
    JOIN packages p ON p.customer_id = o.customer_id
    JOIN package_sessions ps ON ps.package_id = p.id
                            AND ps.check_in_id = o.check_in_id
                            AND ps.deleted_at IS NULL
                            AND ps.session_type = o.mapped_st),
  agg AS (
    SELECT o.cis_pk, o.service_name, o.mapped_st, o.customer_id::text AS customer_id,
           o.price, o.original_price,
           COUNT(c.ps_id) FILTER (WHERE NOT c.ps_claimed)                 AS n_unclaimed,
           MAX(c.ps_id::text) FILTER (WHERE NOT c.ps_claimed)             AS pick_ps_id,
           MAX(c.status)      FILTER (WHERE NOT c.ps_claimed)             AS pick_status
    FROM orphans o LEFT JOIN cand c ON c.cis_pk = o.cis_pk
    GROUP BY o.cis_pk, o.service_name, o.mapped_st, o.customer_id, o.price, o.original_price)
  SELECT cis_pk, service_name, mapped_st, customer_id, price, original_price,
         n_unclaimed, pick_ps_id, pick_status,
         CASE WHEN n_unclaimed = 1 THEN 'A_resolvable'
              WHEN n_unclaimed >= 2 THEN 'B_ambiguous'
              ELSE 'B_absent' END AS partition
  FROM agg ORDER BY partition, cis_pk;`;

const invariantSQL = `
  SELECT
    COUNT(*) FILTER (WHERE is_package_session=true AND package_session_id IS NULL)     AS porphan,
    COUNT(*) FILTER (WHERE is_package_session=true AND package_session_id IS NOT NULL) AS healthy,
    COUNT(*) FILTER (WHERE is_package_session=true)                                    AS flag_true_total,
    COALESCE(SUM(price)          FILTER (WHERE is_package_session=true),0) AS sum_price_flagged,
    COALESCE(SUM(original_price) FILTER (WHERE is_package_session=true),0) AS sum_origprice_flagged
  FROM check_in_services;`;

function die(msg) { console.error(`\n✗ ABORT: ${msg}\n`); process.exit(1); }

(async () => {
  console.log(`=== ${TICKET} — correction ${MODE_APPLY ? 'APPLY' : 'DRY-RUN (no-persistence)'} ===\n`);

  // ── STEP 1: freeze-set 재검증 (신규 발생분 abort) ──
  const live = await q(`SELECT id AS cis_pk FROM check_in_services
                        WHERE is_package_session=true AND package_session_id IS NULL ORDER BY id;`);
  const liveSet = new Set(live.map(r => r.cis_pk));
  const frozenSet = new Set(FREEZE_62);
  const novel = [...liveSet].filter(x => !frozenSet.has(x));   // freeze 밖 신규 orphan
  const vanished = [...frozenSet].filter(x => !liveSet.has(x)); // 이미 해소된 frozen (재실행 idempotency)
  console.log(`[freeze-recheck] live P-orphan=${liveSet.size} · frozen=${FREEZE_62.length} · novel(freeze밖 신규)=${novel.length} · vanished(이미 해소)=${vanished.length}`);
  if (novel.length > 0) {
    console.error('  novel PKs:', novel);
    die(`freeze-set 밖 신규 P-orphan ${novel.length}건 발생 → Q5 seal 위반 가능. apply 중단(SOP: 신규 발생분 abort). planner/supervisor 에스컬레이션 필요.`);
  }

  // ── STEP 2: plan 계산 (exact-anchor partition) ──
  const plan = await q(PLAN_SQL);
  const A = plan.filter(r => r.partition === 'A_resolvable');
  const Bamb = plan.filter(r => r.partition === 'B_ambiguous');
  const Babs = plan.filter(r => r.partition === 'B_absent');
  console.log(`[partition] A_resolvable=${A.length} · B_ambiguous=${Bamb.length} · B_absent=${Babs.length} · total=${plan.length}`);

  // census 기대치 대조 (drift guard). vanished>0 이면 재실행 상황이므로 A 는 그만큼 감소 가능.
  const expA = 28 - vanished.filter(v => true).length >= 0 ? 28 : 28;
  if (vanished.length === 0) {
    if (plan.length !== 62) die(`plan population ${plan.length} ≠ census 62 (freeze drift).`);
    if (A.length !== 28) die(`A_resolvable ${A.length} ≠ census 28 (anchor drift). apply 금지.`);
    if (Bamb.length !== 0) die(`B_ambiguous ${Bamb.length} ≠ census 0 (모호성 발생 → per-row 재판정 필요).`);
    if (Babs.length !== 34) die(`B_absent ${Babs.length} ≠ census 34 (drift).`);
  } else {
    console.log(`  [note] vanished=${vanished.length} (일부 frozen 이미 해소됨) → 재실행/부분적용 상황. count 완화 대조.`);
  }

  // resolvable 무결성: pick_ps_id non-null 유일 + ps 중복 claim 금지
  const badPick = A.filter(r => !r.pick_ps_id);
  if (badPick.length) die(`A_resolvable 중 pick_ps_id NULL ${badPick.length}건 (내부모순).`);
  const psIds = A.map(r => r.pick_ps_id);
  const dupPs = psIds.filter((v, i) => psIds.indexOf(v) !== i);
  if (dupPs.length) die(`동일 package_session 을 복수 orphan 이 claim (${[...new Set(dupPs)]}) → double-draw. apply 금지.`);

  // ── STEP 3: 판정근거 스냅샷 + before-image + rollback SQL ──
  const before = await q(invariantSQL);
  const inv0 = before[0];
  const afRows = A.filter(r => AF_CAVEAT.has(r.cis_pk));
  const snapshot = {
    ticket: TICKET,
    mode: MODE_APPLY ? 'apply' : 'dry-run',
    generated_ref: REF,
    da_ssot: 'agents/docs/da_replies/da_decision_foot_arche_porphan_correction_spec_20260810.md',
    q5_forward_seal: 'H1 (seal) — evidence/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_forensic_seal_result.md',
    freeze_recheck: { live: liveSet.size, frozen: FREEZE_62.length, novel: novel.length, vanished: vanished.length },
    partition: { A_resolvable: A.length, B_ambiguous: Bamb.length, B_absent: Babs.length },
    invariant_before: inv0,
    invariant_expected_after: {
      porphan: Number(inv0.porphan) - A.length,
      healthy: Number(inv0.healthy) + A.length,
      flag_true_total: Number(inv0.flag_true_total),           // 불변 (재-결선은 flag 변경 아님)
      sum_price_flagged: inv0.sum_price_flagged,               // 불변 (매출축 무접촉)
      sum_origprice_flagged: inv0.sum_origprice_flagged,       // 불변
    },
    af_caveat_rows: afRows.map(r => ({ cis_pk: r.cis_pk, service_name: r.service_name, pick_ps_id: r.pick_ps_id,
      note: 'AF 신규명 매핑근거 약함 → 현장/명세 per-row 확인 권고' })),
    // A-resolvable: fill-on-NULL 재-결선 대상 (before-image = package_session_id NULL)
    leg_a_plan: A.map(r => ({
      cis_pk: r.cis_pk, service_name: r.service_name, mapped_session_type: r.mapped_st,
      customer_id: r.customer_id, ps_status: r.pick_status,
      package_session_id_before: null, package_session_id_after: r.pick_ps_id,
      price: r.price, original_price: r.original_price,
      af_caveat: AF_CAVEAT.has(r.cis_pk),
    })),
    // B-absent: ★재-결선 대상 아님 — 현장확정 라우팅 (test-data void 후보). 본 스크립트 무접촉.
    b_absent_routing: Babs.map(r => ({
      cis_pk: r.cis_pk, service_name: r.service_name, customer_id: r.customer_id,
      disposition: 'NO-AUTO-LINK · 현장확정 라우팅 (다수 테스트/더미고객 void 후보). 본 스크립트 손대지 않음.',
    })),
    // reversibility (before-image 기반 rollback)
    rollback_sql: A.length
      ? `UPDATE check_in_services SET package_session_id = NULL\n  WHERE id IN (${A.map(r => `'${r.cis_pk}'`).join(',')})\n    AND package_session_id IN (${A.map(r => `'${r.pick_ps_id}'`).join(',')});`
      : '-- no A-resolvable rows',
    apply_sql_preview: A.slice(0, 3).map(r =>
      `UPDATE check_in_services SET package_session_id='${r.pick_ps_id}' WHERE id='${r.cis_pk}' AND is_package_session=true AND package_session_id IS NULL; -- +${A.length - 3} more`),
  };
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2));
  console.log(`[snapshot] → ${SNAPSHOT_OUT}`);
  console.log(`[invariant before] P-orphan=${inv0.porphan} healthy=${inv0.healthy} flag_true=${inv0.flag_true_total} Σprice=${inv0.sum_price_flagged} Σorigprice=${inv0.sum_origprice_flagged}`);
  console.log(`[expected after]   P-orphan=${snapshot.invariant_expected_after.porphan} healthy=${snapshot.invariant_expected_after.healthy} (Σprice/flag_true 불변)`);
  if (afRows.length) console.log(`[AF caveat] ${afRows.length}건 per-row 확인 flag: ${afRows.map(r => r.cis_pk).join(', ')}`);

  // ── DRY-RUN: 여기서 종료. UPDATE 미발행 = no-persistence by construction ──
  if (!MODE_APPLY) {
    console.log('\n✓ DRY-RUN 완료. prod write 0 (UPDATE 미발행). B-absent 34 무접촉.');
    console.log('  → supervisor DB-GATE: DDL-diff(DDL 0) + dry-run 재검증 + GO-token 발행 후에만 --apply 가능.');
    return;
  }

  // ── APPLY: HARD GATE — supervisor DB-GATE GO-token 선행 필수 ──
  if (!existsSync(GO_TOKEN) || !existsSync(GO_TOKEN_SIG)) {
    die(`GO-token 부재 (${GO_TOKEN} / .sig). supervisor DB-GATE GO-token 발행 전 prod apply 금지(apply_before_go).`);
  }
  if (!HAS_GO_FLAG) {
    die('apply 안전장치: --i-have-go-token 명시 필요 (GO-token 확인 후 supervisor 가 실행).');
  }
  console.log('\n[APPLY] GO-token 확인됨. A-resolvable fill-on-NULL 재-결선 실행...');

  let affected = 0;
  for (const r of A) {
    // per-row · preserve-on-non-NULL 가드 · money-field 무접촉 (package_session_id 만 write)
    const res = await q(
      `UPDATE check_in_services SET package_session_id='${r.pick_ps_id}'
       WHERE id='${r.cis_pk}' AND is_package_session=true AND package_session_id IS NULL
       RETURNING id;`);
    affected += res.length;
  }
  console.log(`[APPLY] rows affected = ${affected} (기대 ${A.length})`);

  // ── POSTCHECK 불변식 ──
  const after = (await q(invariantSQL))[0];
  const exp = snapshot.invariant_expected_after;
  const checks = [
    ['rows_affected == A', affected === A.length],
    [`P-orphan ${after.porphan} == ${exp.porphan}`, Number(after.porphan) === exp.porphan],
    [`healthy ${after.healthy} == ${exp.healthy}`, Number(after.healthy) === exp.healthy],
    [`flag_true 불변 ${after.flag_true_total} == ${inv0.flag_true_total}`, String(after.flag_true_total) === String(inv0.flag_true_total)],
    [`Σprice 불변(매출축)`, String(after.sum_price_flagged) === String(inv0.sum_price_flagged)],
    [`Σorigprice 불변`, String(after.sum_origprice_flagged) === String(inv0.sum_origprice_flagged)],
  ];
  console.log('\n[POSTCHECK]');
  let ok = true;
  for (const [label, pass] of checks) { console.log(`  ${pass ? '✓' : '✗'} ${label}`); if (!pass) ok = false; }
  snapshot.mode = 'apply-done';
  snapshot.rows_affected = affected;
  snapshot.invariant_after = after;
  snapshot.postcheck_pass = ok;
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2));
  if (!ok) die('POSTCHECK 실패 → rollback_sql 로 즉시 되돌림 필요 (snapshot 참조).');
  console.log('\n✓ APPLY + POSTCHECK 완료. 매출축 불변 · B-absent 34 무접촉 · frozen 62 한정.');
})();
