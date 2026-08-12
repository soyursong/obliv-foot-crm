/**
 * reemit_20260812_closing_emit_timing_drift.mjs
 * T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT — Q3 오염 정정(α reemit + β phantom-void)
 * SSOT: agents/docs/da_replies/da_decision_foot_closing_herald_emit_timing_drift_reemit_20260812.md (Q3 · HARD H1~H4)
 *
 * ── 배경(RC, dev-foot firsthand READ-ONLY) ────────────────────────────────────────
 *   E2E CF-5 spec 이 PROD 에 가짜 closed dc(single_card=80,000, memo='CF-5 자동 마감 spec') INSERT
 *   → enqueue 발화 → outbox rev0 슬롯 선점(phantom 80k). 테스트 cleanup 이 dc/payments 만 삭제, outbox 누수.
 *   실 EOD 마감(rev0)의 정상 emit 은 ON CONFLICT DO NOTHING 으로 silent-drop → phantom 80k reader-visible.
 *
 * ── DA Q3 정정 경로 (canonical · 발명 금지) ─────────────────────────────────────────
 *   sub-case α (실 closed dc 존재: 08-07~08-11 · 08-12 진행중):
 *     · LEG 1 = 부모 reemit 재사용(unlock→reconfirm → confirm_guard revision+1 + enqueue 재발화)
 *               → rev+1 신 슬롯 emit(정답 total) + 구 rev supersede.
 *     · LEG 2 = phantom rev0 중립화. ★superseded=true 만으론 불충분 — worker
 *               (process_closing_confirmed_outbox) 는 `WHERE dlq=false AND status IN('pending','processing')`
 *               로 select, superseded 를 필터하지 않음 → phantom pending 이면 워커가 80k 발송(double-announce).
 *               ∴ **dlq=true** 로 중립화(worker 제외) + superseded=true(reader 제외). H3 archive-first: hard-DELETE 금지.
 *   sub-case β (실 closed dc 부재: 08-06):
 *     · ★closing 합성 절대금지(under-correct ≫ over-correct).
 *     · β-1 진성 미마감 → phantom void only(dlq/superseded), emit 0. (--beta1-confirmed 명시 필요)
 *     · β-2 실마감인데 dc 소실 의심 → data-integrity 조사 선행. 애매 시 HOLD + 재-CONSULT(자동 봉합 금지).
 *
 * ── HARD 가드 (H1~H4 · Q3 실집행 = supervisor 물리 GO-token 후) ──────────────────────
 *   H1 source-close 선행(seal-before-backfill): Axis-A(CF-5 prod-write-ban, dev-meta lane)가 배포/봉인된
 *      뒤에만 정정 착수. → --apply 는 --axis-a-sealed 동반 필수(미동반 시 abort). apply-time fresh re-probe.
 *   H2 freeze: phantom 지문(rev0 ∧ memo='CF-5 자동 마감 spec' ∧ total_amount_krw/Σsystem_totals=80,000)으로
 *      대상 정확 명시. blanket/단일-count UPDATE 금지. rows-affected abort-guard(정확히 매칭 건수만).
 *   H3 archive-first / append-supersede: phantom 중립화 = dlq/superseded 마킹(hard-DELETE 아님·가역·audit 보존). rev+1 emit=append.
 *   H4 before-image 스냅샷 + rollback: apply 전 before-image 를 evidence 로 출력.
 *
 * ── GATE ────────────────────────────────────────────────────────────────────────
 *   ★write 0 until supervisor 물리 GO-token. 본 스크립트는 DRY 기본 · --apply 는 supervisor DB-GATE dry-run 승인 +
 *     물리 GO-token + Axis-A 봉인 후에만. 'DDL 0(data-only)' ≠ GO-token 면제(DA §111/H8).
 *
 * usage:
 *   node scripts/reemit_20260812_closing_emit_timing_drift.mjs                          (DRY — 분류 census + before-image only)
 *   node scripts/reemit_20260812_closing_emit_timing_drift.mjs --apply --axis-a-sealed  (α reemit+phantom중립화 실행)
 *   node scripts/reemit_20260812_closing_emit_timing_drift.mjs --apply --axis-a-sealed --beta1-confirmed  (+ β-1 phantom-void)
 * author: dev-foot / 2026-08-12
 */
import { query } from './lib/foot_migration_ledger.mjs';

const APPLY        = process.argv.includes('--apply');
const AXIS_A_SEALED = process.argv.includes('--axis-a-sealed');
const BETA1_OK     = process.argv.includes('--beta1-confirmed');
const SLUG         = process.env.FOOT_SLUG || 'jongno-foot';

// H2 phantom 지문
const PHANTOM_MEMO   = 'CF-5 자동 마감 spec';
const PHANTOM_AMOUNT = 80000;

// 후보 날짜 (H1 apply-time fresh re-probe 로 각 날짜 실분류 — 하드코딩 분류 아님)
const CANDIDATE_DATES = ['2026-08-06','2026-08-07','2026-08-08','2026-08-09','2026-08-10','2026-08-11','2026-08-12'];

const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };
const q1   = async (sql) => (await rows(sql))[0] || null;

const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log('════════════════════════════════════════════════════════════');
console.log(`[${APPLY ? 'APPLY' : 'DRY(census+before-image only)'}] Q3 emit-timing-drift 정정 — ${SLUG} (${nowKst()})`);
console.log(`  gate: axis_a_sealed=${AXIS_A_SEALED} · beta1_confirmed=${BETA1_OK}`);
console.log('════════════════════════════════════════════════════════════\n');

// ── 각 후보 날짜 분류 (fresh probe · H1 apply-time re-probe) ────────────────────────
//   ★안전 우선(under-correct ≫ over-correct · closing 합성 절대금지):
//     ALPHA = 실 closed dc 존재 AND dc 가 test-artifact 아님 (∴ reemit 이 실 total 발사) AND phantom rev0 검출.
//     BETA_HOLD = (dc 가 test-artifact = 실 EOD 미도래·08-12형) 또는 (dc 부재이나 β-1/β-2 판별 미확정) → 자동 write 금지.
//     BETA1_VOID = dc 부재 확정 + 진성 미마감(--beta1-confirmed) → phantom void only(emit 0).
async function classify(date) {
  const dc = await q1(`
    SELECT dc.id::text AS dc_id, dc.revision, dc.status, dc.memo AS memo,
           (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)
           +COALESCE(dc.package_cash_total,0)+COALESCE(dc.single_cash_total,0)
           +COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)) AS sys_total
      FROM public.daily_closings dc JOIN public.clinics c ON c.id = dc.clinic_id
     WHERE c.slug = ${sqlLit(SLUG)} AND dc.close_date = DATE ${sqlLit(date)}
     ORDER BY dc.revision DESC LIMIT 1;`);
  const obx = await rows(`
    SELECT o.revision, o.superseded, o.dlq, o.status,
           (o.payload->>'total_amount_krw') AS total_krw,
           (o.payload->>'memo') AS memo,
           (o.payload->'system_totals'->>'card') AS sys_card
      FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id = o.clinic_id
     WHERE c.slug = ${sqlLit(SLUG)} AND o.close_date = DATE ${sqlLit(date)}
     ORDER BY o.revision;`);
  // phantom 지문 매칭 (H2): rev0 ∧ memo=지문 ∧ (total≈80000 OR sys_card≈80000)
  const phantom = obx.find((o) => Number(o.revision) === 0
    && o.memo === PHANTOM_MEMO
    && (Number(o.total_krw) === PHANTOM_AMOUNT || Number(o.sys_card) === PHANTOM_AMOUNT));
  const realClosedDc = !!dc && dc.status === 'closed';
  // ★dc 자체가 CF-5 test-artifact (실 EOD 미도래·08-12형) — 이걸 reemit 하면 false 80k 발사 → 금지
  const dcIsTestArtifact = !!dc && dc.memo === PHANTOM_MEMO && Number(dc.sys_total) === PHANTOM_AMOUNT;
  // reader/worker 에 아직 위험한 stale rev0 (dlq=false 이면 worker 대상·superseded=false 이면 reader 대상)
  const activeRev0 = obx.find((o) => Number(o.revision) === 0 && (o.dlq === false || o.superseded === false));
  let kind;
  if (realClosedDc && !dcIsTestArtifact && phantom) {
    kind = 'ALPHA (실 closed dc[진성] + phantom → reemit rev+1 + phantom 중립화)';
  } else if (dcIsTestArtifact) {
    kind = 'BETA_HOLD (dc 자체가 CF-5 test-artifact·실 EOD 미도래 → reemit 시 false 80k 발사·금지. HOLD)';
  } else if (!realClosedDc && (phantom || activeRev0)) {
    kind = 'BETA (실 closed dc 부재 → 합성금지·β-1 void only(--beta1-confirmed) / β-2 조사·HOLD)';
  } else if (realClosedDc && !dcIsTestArtifact && !phantom) {
    kind = 'CLEAN (실 closed dc 진성 + phantom 미검출 — 정상·대상 아님)';
  } else {
    kind = 'CLEAN/UNKNOWN (지문·dc 조합 미해당 — 대상 아님·수동 확인)';
  }
  return { date, dc, obx, phantom, realClosedDc, dcIsTestArtifact, activeRev0, kind };
}

const census = [];
for (const d of CANDIDATE_DATES) census.push(await classify(d));

console.log('── 분류 census + before-image (H4) ──');
for (const c of census) {
  console.log(`\n  ▸ ${c.date}: ${c.kind}`);
  console.log(`    dc: ${c.dc ? `rev=${c.dc.revision} status=${c.dc.status} sys_total=${c.dc.sys_total}` : '(없음)'}`);
  for (const o of c.obx)
    console.log(`    outbox rev${o.revision}: superseded=${o.superseded} dlq=${o.dlq} status=${o.status} total_krw=${o.total_krw} memo=${JSON.stringify(o.memo)}${c.phantom && Number(o.revision)===0 ? '  ← PHANTOM(H2 지문 매칭)' : ''}`);
}
console.log('');

const alpha    = census.filter((c) => c.kind.startsWith('ALPHA'));
const beta     = census.filter((c) => c.kind.startsWith('BETA ') || c.kind.startsWith('BETA('));
const betaHold = census.filter((c) => c.kind.startsWith('BETA_HOLD'));

console.log(`── 요약: ALPHA=${alpha.map(c=>c.date).join(',')||'없음'} · BETA=${beta.map(c=>c.date).join(',')||'없음'} · BETA_HOLD=${betaHold.map(c=>c.date).join(',')||'없음'} ──`);
if (betaHold.length)
  console.log(`  ⚠ BETA_HOLD(${betaHold.map(c=>c.date).join(',')}) = dc 가 CF-5 test-artifact(실 EOD 미도래). ★자동 write 0 — reemit 시 false 80k 발사 위험. 실 EOD 후 재-probe 또는 planner/DA 판별 선행.`);
console.log('');

if (!APPLY) {
  console.log('DRY 종료(write 0). 실행 전제: supervisor DB-GATE dry-run 승인 + 물리 GO-token + Axis-A(CF-5 prod-write-ban) 봉인.');
  console.log('실행: node scripts/reemit_20260812_closing_emit_timing_drift.mjs --apply --axis-a-sealed [--beta1-confirmed]');
  process.exit(0);
}

// ── H1 seal-before-backfill: Axis-A 미봉인 시 착수 금지 ──
if (!AXIS_A_SEALED) {
  console.error('❌ H1 위반 차단: --axis-a-sealed 미동반. Axis-A(CF-5 prod-write-ban, dev-meta lane) 배포/봉인 전 Q3 정정 착수 금지(재오염). abort.');
  process.exit(2);
}

const evidence = { reemit_at: nowKst(), slug: SLUG, alpha: [], beta: [] };

// ── ALPHA: per-date 원자 txn — LEG2(phantom 중립화) → LEG1(reconfirm rev+1) ──
for (const c of alpha) {
  const date = c.date;
  console.log(`── [ALPHA] ${date}: LEG2 phantom dlq 중립화 → LEG1 unlock→reconfirm(rev+1) ──`);
  await query(`
DO $reemit$
DECLARE
  v_id       uuid;
  v_old_rev  int;
  v_new_rev  int;
  v_neut     int;
BEGIN
  -- LEG 2: phantom rev0 중립화 (H2 지문 정확 매칭 · rows-affected guard · H3 dlq/superseded 마킹, hard-DELETE 아님)
  UPDATE public.closing_confirmed_outbox o
     SET dlq = true, superseded = true, dlq_alerted = true,
         last_error = COALESCE(o.last_error,'') || ' | Q3-EMIT-TIMING-DRIFT: CF-5 phantom 중립화(dev-foot, GO-token 후) — worker 제외 + reader 제외',
         updated_at = now()
    FROM public.clinics c
   WHERE o.clinic_id = c.id AND c.slug = ${sqlLit(SLUG)}
     AND o.close_date = DATE ${sqlLit(date)}
     AND o.revision = 0
     AND (o.payload->>'memo') = ${sqlLit(PHANTOM_MEMO)}
     AND ( (o.payload->>'total_amount_krw')::bigint = ${PHANTOM_AMOUNT}
        OR (o.payload->'system_totals'->>'card')::bigint = ${PHANTOM_AMOUNT} );
  GET DIAGNOSTICS v_neut = ROW_COUNT;
  IF v_neut <> 1 THEN
    RAISE EXCEPTION '[ALPHA ${date}] phantom 중립화 rows-affected=% (기대 1, H2 freeze 위반) — abort', v_neut;
  END IF;

  -- LEG 1: 실 closed dc 재확정(unlock→reconfirm) → confirm_guard revision+1 + enqueue 재발화(rev+1 emit + 구 rev supersede)
  SELECT dc.id, dc.revision INTO v_id, v_old_rev
    FROM public.daily_closings dc JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE c.slug = ${sqlLit(SLUG)} AND dc.close_date = DATE ${sqlLit(date)} AND dc.status = 'closed'
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION '[ALPHA ${date}] closed 마감 미발견(재emit 불가) — abort';
  END IF;

  UPDATE public.daily_closings
     SET status='open', unconfirmed_at=now(),
         unconfirm_reason='Q3-EMIT-TIMING-DRIFT reemit(dev-foot, T-20260812-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT)',
         updated_at=now()
   WHERE id = v_id;
  UPDATE public.daily_closings
     SET status='closed', closed_at=now(), updated_at=now()
   WHERE id = v_id;

  SELECT revision INTO v_new_rev FROM public.daily_closings WHERE id = v_id;
  IF v_new_rev <> v_old_rev + 1 THEN
    RAISE EXCEPTION '[ALPHA ${date}] revision bump 실패(% -> %, 기대 %) — abort', v_old_rev, v_new_rev, v_old_rev+1;
  END IF;
  RAISE NOTICE '[ALPHA ${date}] phantom 중립화(1행) + reconfirm revision % -> %', v_old_rev, v_new_rev;
END
$reemit$;`);

  // POSTCHECK
  const post = await rows(`
    SELECT o.revision, o.superseded, o.dlq, o.status, (o.payload->>'total_amount_krw') AS total_krw
      FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id = o.clinic_id
     WHERE c.slug = ${sqlLit(SLUG)} AND o.close_date = DATE ${sqlLit(date)} ORDER BY o.revision;`);
  const reader = await q1(`
    SELECT e.revision, (e.payload->>'total_amount_krw') AS total_krw
      FROM public.read_closing_confirmed_events(NULL, NULL, 5000) e
     WHERE e.clinic_slug = ${sqlLit(SLUG)} AND (e.payload->>'close_date') = ${sqlLit(date)}
     ORDER BY e.revision DESC LIMIT 1;`);
  const newRev = post.filter(o => !o.superseded && !o.dlq).sort((a,b)=>Number(b.revision)-Number(a.revision))[0];
  const phantom0 = post.find(o => Number(o.revision) === 0);
  const pass = !!newRev && Number(newRev.revision) >= 1
    && !!phantom0 && phantom0.superseded === true && phantom0.dlq === true
    && !!reader && Number(reader.revision) === Number(newRev.revision);
  console.log(`  reader sees rev=${reader?.revision} total=${reader?.total_krw} | phantom rev0 superseded=${phantom0?.superseded} dlq=${phantom0?.dlq} | ${pass?'✅':'❌'}`);
  evidence.alpha.push({ date, before: c.obx, after: post, reader_visible: reader, pass });
}

// ── BETA_HOLD: dc 가 CF-5 test-artifact(실 EOD 미도래·08-12형) — ★자동 write 0. reemit=false 80k 위험 ──
for (const c of betaHold) {
  console.log(`── [BETA_HOLD] ${c.date}: dc 자체가 CF-5 test-artifact(실 EOD 미도래) → 자동 write 0(reemit 금지·합성 금지).`);
  console.log(`         실 EOD 후 재-probe(dc→진성 total) 시 ALPHA 로 재분류되어 정정 가능. 그 전엔 HOLD. (phantom worker 발송은 B-narrow loud-fail + 별도 확인)`);
  evidence.beta.push({ date: c.date, action: 'BETA_HOLD — dc=CF-5 test-artifact(실 EOD 미도래)·자동 write 0(under-correct)', before: c.obx });
}

// ── BETA: closing 합성 절대금지. β-1(void only, --beta1-confirmed 필요) / β-2(조사→HOLD) ──
for (const c of beta) {
  const date = c.date;
  // 이미 중립화된 rev0(failed/dlq — 부모 아티팩트)면 emit 0 이 이미 만족 → void 불요
  const alreadyNeutralized = c.obx.every((o) => Number(o.revision) !== 0 || (o.dlq === true && o.superseded === true))
    && c.obx.some((o) => Number(o.revision) === 0);
  const hasCfPhantom = !!c.phantom && !(c.phantom.dlq === true && c.phantom.superseded === true);

  if (alreadyNeutralized && !hasCfPhantom) {
    console.log(`── [BETA] ${date}: dc 부재 + rev0 이미 중립화(failed/dlq·reader/worker 제외) → emit 0 이미 만족. 자동 write 0.`);
    console.log(`         ★단 β-1(진성 미마감)/β-2(dc 소실) DoD 판별은 여전히 필요(planner/DA). 합성 금지.`);
    evidence.beta.push({ date, action: 'BETA — rev0 이미 중립화(emit 0 만족)·write 0·β-1/β-2 판별만 잔여', before: c.obx });
    continue;
  }
  if (!BETA1_OK || !hasCfPhantom) {
    console.log(`── [BETA] ${date}: dc 부재${hasCfPhantom ? ' + active CF-5 phantom rev0' : ''} → 자동 봉합 금지. β-1(진성 미마감) vs β-2(dc 소실) 판별 선행 필요.`);
    console.log(`         closing 합성 절대금지. β-1 확정 시 --beta1-confirmed(+ active CF-5 phantom 존재 시) phantom-void(emit 0). β-2 의심 시 HOLD + planner 재-CONSULT(data-integrity 조사).`);
    evidence.beta.push({ date, action: `STOP — β-1/β-2 판별 미확정${hasCfPhantom ? '(active CF-5 phantom 존재)' : '(void 대상 CF-5 phantom 부재)'}`, before: c.obx });
    continue;
  }
  console.log(`── [BETA-1] ${date}: 진성 미마감 확정(--beta1-confirmed) + active CF-5 phantom → phantom void only(emit 0·합성 금지) ──`);
  await query(`
DO $void$
DECLARE v_neut int;
BEGIN
  UPDATE public.closing_confirmed_outbox o
     SET dlq = true, superseded = true, dlq_alerted = true,
         last_error = COALESCE(o.last_error,'') || ' | Q3-EMIT-TIMING-DRIFT β-1: 진성 미마감 phantom void(dev-foot, GO-token 후) — emit 0·합성 금지',
         updated_at = now()
    FROM public.clinics c
   WHERE o.clinic_id = c.id AND c.slug = ${sqlLit(SLUG)}
     AND o.close_date = DATE ${sqlLit(date)}
     AND o.revision = 0
     AND (o.payload->>'memo') = ${sqlLit(PHANTOM_MEMO)}
     AND ( (o.payload->>'total_amount_krw')::bigint = ${PHANTOM_AMOUNT}
        OR (o.payload->'system_totals'->>'card')::bigint = ${PHANTOM_AMOUNT} )
     AND NOT (o.dlq = true AND COALESCE(o.superseded,false) = true);
  GET DIAGNOSTICS v_neut = ROW_COUNT;
  IF v_neut <> 1 THEN
    RAISE EXCEPTION '[BETA-1 ${date}] phantom void rows-affected=% (기대 1, H2 freeze 위반) — abort', v_neut;
  END IF;
  RAISE NOTICE '[BETA-1 ${date}] phantom void(1행, emit 0·합성 금지)';
END
$void$;`);
  const post = await rows(`
    SELECT o.revision, o.superseded, o.dlq, o.status FROM public.closing_confirmed_outbox o
     JOIN public.clinics c ON c.id = o.clinic_id
     WHERE c.slug = ${sqlLit(SLUG)} AND o.close_date = DATE ${sqlLit(date)} ORDER BY o.revision;`);
  const reader = await q1(`
    SELECT e.revision FROM public.read_closing_confirmed_events(NULL, NULL, 5000) e
     WHERE e.clinic_slug = ${sqlLit(SLUG)} AND (e.payload->>'close_date') = ${sqlLit(date)} LIMIT 1;`);
  const pass = !reader; // void 후 reader 가 아무것도 안 봄(emit 0)
  console.log(`  reader visible=${reader ? 'rev'+reader.revision+'(❌ 잔존)' : '없음(✅ void)'} `);
  evidence.beta.push({ date, action: 'β-1 phantom void', before: c.obx, after: post, reader_visible: reader, pass });
}

console.log('\n── EVIDENCE (supervisor 사후검증용) ──');
console.log(JSON.stringify(evidence, null, 2));
const allPass = evidence.alpha.every(e => e.pass) && evidence.beta.every(e => e.action.startsWith('β-1') ? e.pass : true);
console.log('\n' + (allPass ? '✅ Q3 정정 완료(α reemit + phantom 중립화 · β 처리).' : '❌ 일부 실패/보류 — supervisor 회신 전 확인 필요.'));
process.exit(allPass ? 0 : 1);
