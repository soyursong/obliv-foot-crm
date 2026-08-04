/**
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE — 재emit(revision+1) STEP3 APPLY
 *
 * supervisor FIX-REQUEST MSG-20260804-183713-62fa (사전 승인 동봉, prod DB emit 액션 한정).
 *
 * ── 무엇 ──
 *   07-31~08-04 中 "마감확정(status=closed) 존재 + 틀린 전령이 나갔던" 일자를 daily_closings actual 기준으로
 *   outbox 재emit(revision+1). STEP1 probe 실측 대상셋(FREEZE) = jongno-foot 08-01, jongno-foot 08-03.
 *   (07-31=open·08-02/08-04=마감확정 부재·songdo-foot=대상 부재 → 재emit 제외.)
 *
 * ── 정당경로(가드1) ──
 *   reopen→reconfirm: daily_closings STEP A(closed→open, unconfirmed_at set) → STEP B(open→closed).
 *   STEP B 가 trg_daily_closing_confirm_guard(BEFORE, revision+1) + trg_enqueue_closing_confirmed(AFTER,
 *   v1.5 payload recompute + INV5 게이트 → outbox 신규행 rev+1) 재발화. outbox 직접 INSERT 우회 아님.
 *   = closing_confirmed_edit RPC(20260802160001) 와 동일 경로(RPC 는 auth.uid 요구 → service_role 컨텍스트
 *   불가하므로 RPC 가 내부적으로 수행하는 두 UPDATE 를 동형으로 실행).
 *
 * ── 가드2 (daily_closings 수치 무변) ──
 *   actual_ / package_ / single_ / difference / memo / confirmed_by / closed_at 미변경(SET 안 함).
 *   STEP2 안전 probe 로 monetary write 트리거 부재 확인 완료. DO 블록 내 before/after 대조 assert 로 이중 방어.
 *   변경 = status·unconfirmed_*·revision(트리거)·payments_snapshot_hash(트리거)·updated_at(트리거)뿐.
 *
 * ── 가드3 (self-test 통과분만 발송) ──
 *   재emit payload 는 리더(socket_listener PID 89013)의 3중 self-test(G1/G2/G3) 통과분만 자동발송(미통과=DLQ).
 *   본 스크립트는 outbox 신규행 생성 + enqueue 내장 INV5 게이트까지. 리더 발송은 supervisor 육안감시.
 *
 * usage: node <this>            (DRY — 대상셋/현상태만, write 0)
 *        node <this> --apply    (실 재emit + POSTCHECK)
 * author: dev-foot / 2026-08-04
 */
import { query } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

// ── FREEZE 대상셋 (STEP1 probe 2026-08-04 18:51 실측 근거) ──
const WATERMARK = '2026-08-03T15:47:12.600443+00';
const TARGETS = [
  { slug: 'jongno-foot', clinic_id: '74967aea-a60b-4da3-a0e7-9c997a930bc8', close_date: '2026-08-01', expect_total: 11353900 },
  { slug: 'jongno-foot', clinic_id: '74967aea-a60b-4da3-a0e7-9c997a930bc8', close_date: '2026-08-03', expect_total: 17964200 },
];

console.log('════════════════════════════════════════════════════════════');
console.log(`[${APPLY ? 'APPLY(실 재emit)' : 'DRY'}] foot CLOSING-HERALD 재emit(revision+1) — ${nowKst()}`);
console.log(`대상 FREEZE: ${TARGETS.map((t) => `${t.slug}/${t.close_date}`).join(', ')}`);
console.log('════════════════════════════════════════════════════════════\n');

// ── PRE: 대상 마감 상태 + 현 outbox ──
for (const t of TARGETS) {
  const dc = (await rows(`
    SELECT status, revision, actual_card_total AS a_card, actual_cash_total AS a_cash,
           actual_transfer_total AS a_tr, difference, closed_at
      FROM public.daily_closings
     WHERE clinic_id='${t.clinic_id}'::uuid AND close_date='${t.close_date}'::date;`))[0];
  console.log(`── PRE ${t.slug}/${t.close_date}: status=${dc?.status} rev=${dc?.revision} actual(card=${dc?.a_card},cash=${dc?.a_cash},tr=${dc?.a_tr}) diff=${dc?.difference}`);
  if (!dc || dc.status !== 'closed') {
    console.log(`   ⚠ status != closed → 재emit 대상 아님(가드: 마감확정 존재). SKIP.`);
    t._skip = true;
  }
}
console.log('');

if (!APPLY) {
  console.log('DRY 종료. 실행: node scripts/T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE_reemit_step3_apply.mjs --apply');
  process.exit(0);
}

// ── APPLY: per-date 원자 reopen→reconfirm (DO 블록, monetary before/after assert 내장) ──
const evidence = [];
for (const t of TARGETS) {
  if (t._skip) { evidence.push({ ...t, result: 'SKIP(not closed)' }); continue; }
  console.log(`── 재emit ${t.slug}/${t.close_date} ──`);
  const doBlock = `
DO $reemit$
DECLARE
  v_dc     public.daily_closings%ROWTYPE;
  v_after  public.daily_closings%ROWTYPE;
BEGIN
  SELECT * INTO v_dc FROM public.daily_closings
    WHERE clinic_id='${t.clinic_id}'::uuid AND close_date='${t.close_date}'::date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found %', '${t.close_date}'; END IF;
  IF v_dc.status <> 'closed' THEN RAISE EXCEPTION 'not_closed status=% (재emit 대상 아님)', v_dc.status; END IF;

  -- STEP A: reopen (closed→open) — unconfirmed_at set → confirm_guard else-branch(revision 불변)
  UPDATE public.daily_closings
    SET status='open', unconfirmed_at=now(), unconfirmed_by=NULL,
        unconfirm_reason='herald payload reconcile re-emit (T-20260804 FIX-REQUEST MSG-...62fa, dev-foot)'
    WHERE id=v_dc.id;

  -- STEP B: reconfirm (open→closed) — confirm_guard revision+1 + enqueue(AFTER) v1.5 recompute outbox
  --   ★monetary 미변경(actual_*/package_*/single_*/difference/memo/confirmed_by/closed_at SET 안 함)
  UPDATE public.daily_closings SET status='closed' WHERE id=v_dc.id;

  -- assert: monetary 무변(가드2) + revision+1
  SELECT * INTO v_after FROM public.daily_closings WHERE id=v_dc.id;
  IF v_after.actual_card_total     IS DISTINCT FROM v_dc.actual_card_total
  OR v_after.actual_cash_total     IS DISTINCT FROM v_dc.actual_cash_total
  OR v_after.actual_transfer_total IS DISTINCT FROM v_dc.actual_transfer_total
  OR v_after.package_card_total     IS DISTINCT FROM v_dc.package_card_total
  OR v_after.package_cash_total     IS DISTINCT FROM v_dc.package_cash_total
  OR v_after.package_transfer_total IS DISTINCT FROM v_dc.package_transfer_total
  OR v_after.single_card_total      IS DISTINCT FROM v_dc.single_card_total
  OR v_after.single_cash_total      IS DISTINCT FROM v_dc.single_cash_total
  OR v_after.single_transfer_total  IS DISTINCT FROM v_dc.single_transfer_total
  OR v_after.difference             IS DISTINCT FROM v_dc.difference THEN
    RAISE EXCEPTION 'GUARD2 위반: monetary drift 감지 — rollback';
  END IF;
  IF v_after.revision <> v_dc.revision + 1 THEN
    RAISE EXCEPTION 'revision 미증가: % -> % (기대 +1)', v_dc.revision, v_after.revision;
  END IF;
  RAISE NOTICE 'reemit OK %/%  rev %->%  monetary 무변', '${t.slug}', '${t.close_date}', v_dc.revision, v_after.revision;
END
$reemit$;`;
  try {
    await query(doBlock);
    // POSTCHECK: 신규 outbox 행(rev+1)
    const ob = (await rows(`
      SELECT revision, status, dlq, superseded,
             (payload ->> 'schema_version') AS sv,
             (payload ->> 'total_amount_krw') AS total_amount_krw,
             (payload -> 'split_source') AS split_source,
             (payload -> 'inv5_divergence') AS inv5_divergence,
             event_id, created_at, last_error
        FROM public.closing_confirmed_outbox
       WHERE clinic_id='${t.clinic_id}'::uuid AND close_date='${t.close_date}'::date
       ORDER BY revision DESC LIMIT 1;`))[0];
    const okTotal = Number(ob?.total_amount_krw) === t.expect_total;
    const past = new Date(ob?.created_at).getTime() > new Date(WATERMARK).getTime();
    console.log(`   ✅ 신규 outbox rev=${ob?.revision} status=${ob?.status} dlq=${ob?.dlq} superseded=${ob?.superseded} sv=${ob?.sv}`);
    console.log(`      total_amount_krw=${ob?.total_amount_krw} (기대 ${t.expect_total} → ${okTotal ? 'MATCH' : 'MISMATCH'})`);
    console.log(`      split_source=${JSON.stringify(ob?.split_source)} event_id=${ob?.event_id}`);
    console.log(`      created_at=${ob?.created_at} > watermark? ${past}  last_error=${ob?.last_error ?? 'null'}`);
    if (ob?.inv5_divergence) console.log(`      ⚠ inv5_divergence=${JSON.stringify(ob.inv5_divergence)}`);
    evidence.push({ slug: t.slug, close_date: t.close_date, new_revision: ob?.revision, status: ob?.status,
      dlq: ob?.dlq, total_amount_krw: ob?.total_amount_krw, expect_total: t.expect_total, total_match: okTotal,
      superseded: ob?.superseded, event_id: ob?.event_id, created_at: ob?.created_at,
      after_watermark: past, last_error: ob?.last_error ?? null });
  } catch (e) {
    console.log(`   ❌ 실패 → 롤백됨: ${e.message}`);
    evidence.push({ slug: t.slug, close_date: t.close_date, result: 'FAIL', error: e.message });
  }
  console.log('');
}

console.log('── EVIDENCE (FOLLOWUP 회신용) ──');
console.log(JSON.stringify({ applied_at: nowKst(), watermark: WATERMARK, reemit: evidence }, null, 2));

const allOk = evidence.every((e) => e.result === 'SKIP(not closed)' || (e.status && e.dlq === false && e.total_match));
console.log(`\n${allOk ? '✅ 재emit 전건 성공 (self-test 통과분 status=pending·dlq=false → 리더 자동발송 대기)' : '⚠ 일부 DLQ/미일치 — supervisor 확인 필요'}`);
process.exit(allOk ? 0 : 1);
