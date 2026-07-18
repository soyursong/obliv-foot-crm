/**
 * T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL — APPLY (Pass1)
 * ────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 게이트#4: APPLY.
 *   전제 게이트: #2 dry-run pass(_dryrun.out.json, committed) + #3 supervisor 백필승인.
 *   판정: SetA(DA-strict first-touch) 채택 (planner MSG-20260716-150653, dev-foot z3tc 권고 A안).
 *
 * ⚠⚠ 이 스크립트는 prod(customers.visit_route)에 UPDATE를 수행한다.
 *   supervisor 백필승인(게이트#3) 전에는 실행 금지. 코드-레벨 가드:
 *   `--i-have-supervisor-backfill-approval` 인자 없이는 착수 거부(no prod write).
 *
 * SOP 준수 요소:
 *   (1) 단일 count 기준 일괄 UPDATE 금지 → 대상 = **frozen SetA(리뷰된 evidence) ∩ 여전히 NULL/''**.
 *   (2) 대상셋 freeze + APPLY 직전 재검증 불일치 시 abort:
 *         - value_mismatch(frozen new_value ≠ 현재 매핑) → ABORT
 *         - out-of-CHECK-domain 매핑 → ABORT
 *         - forward-sync로 이미 채워진 frozen 고객 → skip(멱등·no-clobber, benign)
 *         - freeze에 없던 신규 first-touch-eligible NULL 고객 → **적용 안 함**, REPORT(drift-up).
 *           (신규 고객은 forward-sync가 생성시점에 이미 커버 → historical 백필은 frozen 셋 한정)
 *   (3) archive-first: UPDATE 직전 대상행 (id·old visit_route·적용값) 스냅샷 → _APPLY_archive.json
 *   (4) before/after COUNT 로그
 *   (5) 판정근거 = frozen evidence(_dryrun.out.json) 동봉
 *   (6) 원장(schema_migrations) 무접점 — DDL 0, pure DML
 *   (7) APPLY/ROLLBACK 페어 — 짝 = _rollback.mjs (archive 기반 복원)
 *   + 멱등 guard: UPDATE ... WHERE visit_route IS NULL OR visit_route='' → 재실행 안전.
 *
 * ⚠ 잔존 정합 기준(AC4): "154" 정수는 planner 판정 시점(~15:06) 스냅샷 — 본 러너는
 *   APPLY 시점 frozen∩still-NULL 실측 정수를 스탬프한다(live forward-sync로 universe가
 *   지속 축소 → 고정 정수 anchor 금지, SOP "단일 count 금지" 정신). 정당 잔존:
 *   cust 2997fc1c(최초접점 route NULL, forward-fill 금지) + no-source 고객(예약경로 자체 없음).
 *
 * PHI 라우팅: id/visit_route/created_at/source_system만 — name/phone/RRN 미조회.
 *
 * usage:
 *   node scripts/T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL_apply.mjs \
 *        --i-have-supervisor-backfill-approval [--dry]
 *   --dry : re-derive + drift-check + archive 작성까지만, UPDATE 미실행(리허설)
 */
import { q } from './dryrun_lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'scripts/T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL';
const CHECK_DOMAIN = ['TM', '워크인', '인바운드', '지인소개', '네이버', '인콜'];
const MAP = (v) => (v === '인콜' ? '인바운드' : v); // A안: 인콜→인바운드, 그 외 identity
const NONEMPTY = `visit_route IS NOT NULL AND visit_route <> ''`;
const OOS_2997 = '2997fc1c-1164-4cc2-b5e1-5e381ad84658'; // 정당 잔존(최초접점 NULL, forward-fill 금지)

// ── 코드-레벨 게이트#3 (supervisor 백필승인) ─────────────────────────────────
const args = process.argv.slice(2);
const APPROVED = args.includes('--i-have-supervisor-backfill-approval');
const DRY = args.includes('--dry');
if (!APPROVED) {
  console.error(`
❌ APPLY BLOCKED — supervisor 백필승인(SOP 게이트#3) 미확인.
   이 러너는 prod customers.visit_route 에 UPDATE 를 수행한다.
   supervisor 가 archive-first 스냅샷 + dry-run evidence 검수 후 백필승인을 발행하면,
   그 승인 근거를 확인하고 아래 인자로 재실행:
     node scripts/${ROOT.split('/').pop()}_apply.mjs --i-have-supervisor-backfill-approval
   (리허설: 위 인자 + --dry → UPDATE 없이 drift-check + archive 작성만)
`);
  process.exit(64);
}

// ── frozen SetA 로드 (리뷰된 판정근거) ───────────────────────────────────────
const evidence = JSON.parse(readFileSync(`${ROOT}_dryrun.out.json`, 'utf8'));
const frozen = evidence.freeze_primary_DA_strict.rows; // [{customer_id, src_route, new_visit_route}]
const frozenIds = new Set(frozen.map((r) => r.customer_id));
const frozenVal = new Map(frozen.map((r) => [r.customer_id, r.new_visit_route]));
console.log(`== frozen SetA (evidence): ${frozen.length} rows · rule=${evidence.freeze_primary_DA_strict.rule}`);

// ── APPLY 시점 재검증: 현재 first-touch-eligible 상태 ─────────────────────────
const nowEligible = await q(`
  WITH tgt AS (SELECT id FROM customers WHERE visit_route IS NULL OR visit_route = ''),
  first_resv AS (
    SELECT DISTINCT ON (r.customer_id) r.customer_id, r.visit_route, r.created_at
    FROM reservations r JOIN tgt ON tgt.id = r.customer_id
    ORDER BY r.customer_id, r.created_at ASC, r.id ASC)
  SELECT customer_id, visit_route AS src FROM first_resv WHERE ${NONEMPTY}`);
const nowMapped = nowEligible.map((r) => ({ customer_id: r.customer_id, src: r.src, new_value: MAP(r.src) }));
const nowIds = new Set(nowMapped.map((r) => r.customer_id));

// ── drift-check (abort 조건) ─────────────────────────────────────────────────
const outOfDomain = [...new Set(nowMapped.map((r) => r.new_value))].filter((v) => !CHECK_DOMAIN.includes(v));
const valueMismatch = nowMapped.filter((r) => frozenIds.has(r.customer_id) && frozenVal.get(r.customer_id) !== r.new_value);
const filledSinceDryrun = frozen.filter((r) => !nowIds.has(r.customer_id)); // forward-sync가 채웠거나 대상서 이탈 → skip(benign)
const newEligibleNotFrozen = nowMapped.filter((r) => !frozenIds.has(r.customer_id) && r.customer_id !== OOS_2997);

console.log(`\n== APPLY-time drift-check ==`);
console.log(`  now first-touch-eligible NULL/'' : ${nowMapped.length}`);
console.log(`  out-of-CHECK-domain mapping (ABORT if >0): ${JSON.stringify(outOfDomain)}`);
console.log(`  value_mismatch vs frozen (ABORT if >0)   : ${valueMismatch.length} ${JSON.stringify(valueMismatch.slice(0, 5))}`);
console.log(`  frozen filled/left since dry-run (skip)  : ${filledSinceDryrun.length} ${JSON.stringify(filledSinceDryrun.slice(0, 5).map((r) => r.customer_id))}`);
console.log(`  NEW eligible not in freeze (REPORT only) : ${newEligibleNotFrozen.length} ${JSON.stringify(newEligibleNotFrozen.slice(0, 10))}`);

if (outOfDomain.length) { console.error(`\n❌ ABORT — 매핑값이 customers CHECK 도메인 밖: ${JSON.stringify(outOfDomain)}`); process.exit(2); }
if (valueMismatch.length) { console.error(`\n❌ ABORT — frozen new_value ≠ 현재 매핑 (소스 route 변경 의심). 재판정 필요.`); process.exit(2); }

// ── 실제 대상 = frozen ∩ 현재도 NULL/''(멱등·no-clobber) ─────────────────────
const targets = frozen.filter((r) => nowIds.has(r.customer_id)); // still-NULL & still first-touch-eligible & same value(위 mismatch 통과)
console.log(`\n== 실제 UPDATE 대상 = frozen ∩ still-NULL : ${targets.length} (frozen ${frozen.length} − filled/left ${filledSinceDryrun.length})`);

if (newEligibleNotFrozen.length) {
  console.log(`  ⚠ NOTE: freeze 이후 신규 first-touch-eligible ${newEligibleNotFrozen.length}건 발견 — 본 APPLY 미포함(미리뷰).`);
  console.log(`         신규 고객은 forward-sync(15efde96)가 생성시점 커버. 필요 시 planner에 Pass1b 판단 요청.`);
}

// ── (3) archive-first 스냅샷 ─────────────────────────────────────────────────
const archive = {
  ticket: 'T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL',
  db: evidence.db,
  mode: DRY ? 'DRY-REHEARSAL (no UPDATE)' : 'APPLY',
  frozen_count: frozen.length,
  target_count: targets.length,
  skipped_filled_since_dryrun: filledSinceDryrun.map((r) => r.customer_id),
  new_eligible_not_frozen: newEligibleNotFrozen,
  rows: targets.map((r) => ({ customer_id: r.customer_id, old_visit_route: null, applied_value: r.new_visit_route })),
};
writeFileSync(`${ROOT}_APPLY_archive.json`, JSON.stringify(archive, null, 2));
console.log(`\n== archive-first 스냅샷 written → ${ROOT}_APPLY_archive.json (${targets.length} rows) ==`);

if (DRY) {
  console.log(`\n== --dry 리허설 종료 (UPDATE 미실행). 대상 ${targets.length}건 준비 완료. ==`);
  process.exit(0);
}
if (!targets.length) { console.log(`\n✅ 대상 0건 — 이미 전량 채워짐(멱등). UPDATE 불요.`); process.exit(0); }

// ── (before) 분포 ────────────────────────────────────────────────────────────
const before = await q(`SELECT COALESCE(NULLIF(visit_route,''),'<NULL>') v, count(*)::int n FROM customers GROUP BY 1 ORDER BY 2 DESC`);
console.log(`\n== BEFORE customers.visit_route dist ==\n  ${JSON.stringify(before)}`);

// ── UPDATE (단일 원자 statement · 멱등 IS NULL/'' guard · no-clobber) ─────────
const values = targets.map((r) => `('${r.customer_id}'::uuid, '${r.new_visit_route}')`).join(',');
const updSql = `
  UPDATE customers c SET visit_route = v.newval
  FROM (VALUES ${values}) AS v(id, newval)
  WHERE c.id = v.id
    AND (c.visit_route IS NULL OR c.visit_route = '')   -- no-clobber + 멱등
  RETURNING c.id`;
const updated = await q(updSql);
console.log(`\n▶ UPDATE 적용: ${updated.length} row 변경 (기대 ${targets.length})`);

// ── (after) post-verify ──────────────────────────────────────────────────────
const after = await q(`SELECT COALESCE(NULLIF(visit_route,''),'<NULL>') v, count(*)::int n FROM customers GROUP BY 1 ORDER BY 2 DESC`);
console.log(`== AFTER customers.visit_route dist ==\n  ${JSON.stringify(after)}`);

// frozen 잔존 검증: 적용 후 frozen 고객 중 여전히 NULL = 0 기대
const frozenResidual = await q(`
  SELECT count(*)::int n FROM customers
  WHERE id IN (${frozen.map((r) => `'${r.customer_id}'`).join(',')})
    AND (visit_route IS NULL OR visit_route = '')`);
// 2997fc1c(정당 잔존) 여전히 NULL 이어야
const oos = await q(`SELECT COALESCE(visit_route,'<NULL>') v FROM customers WHERE id = '${OOS_2997}'`);

const okResidual = Number(frozenResidual[0].n) === 0;
const okOOS = oos.length && (oos[0].v === '<NULL>');
console.log(`\n== POST-VERIFY ==`);
console.log(`  frozen 잔존 NULL (기대 0)            : ${frozenResidual[0].n} ${okResidual ? '✅' : '❌'}`);
console.log(`  out-of-scope 2997fc1c 잔존 NULL(기대) : ${oos[0]?.v} ${okOOS ? '✅' : '❌'}`);
console.log(`  실변경 = ${updated.length} / frozen ${frozen.length} / skip(사전충족) ${filledSinceDryrun.length}`);

const pass = okResidual && okOOS && updated.length === targets.length;
console.log(pass
  ? `\n✅ APPLY OK — frozen∩still-NULL ${updated.length}건 채움, frozen 잔존 0, 2997fc1c 정당 NULL 유지. ROLLBACK 짝=_rollback.mjs(archive 기반).`
  : `\n❌ APPLY VERIFY MISMATCH — 위 항목 확인. 필요 시 _rollback.mjs 로 복원.`);
process.exit(pass ? 0 : 1);
