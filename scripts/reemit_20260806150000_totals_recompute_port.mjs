/**
 * reemit_20260806150000_totals_recompute_port.mjs
 * T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT — 마이그 20260806150000 apply 후속 재emit
 *
 * ── 배경 ──────────────────────────────────────────────────────────────────────
 *   마이그 20260806150000(total=daily_closings 확정 구성분 recompute)을 supervisor APPLY 후, 기존 outbox 잔재:
 *     · 08-04 rev0 = total=0(가드 前 오보)·superseded=false·pending   → 정정 필요
 *     · 08-05 rev0 = status=failed·dlq=true·total=null(INV5 발산)      → 정정 필요
 *     · 08-06 rev0 = status=failed·dlq=true·total=null (★daily_closings 08-06 closed 행 부재 = 재발화 대상 아님)
 *   함수 교체만으로는 기존 outbox 행이 소급 정정되지 않음 → 정당경로 재emit 필요.
 *
 * ── 정당경로(legitimate path) ─────────────────────────────────────────────────
 *   raw outbox UPDATE(우회) 금지. daily_closings 재확정(closing_confirmed_edit RPC 동선 동형:
 *   STEP A 해제(closed→open) → STEP B 재확정(open→closed)) → confirm_guard(revision+1) + enqueue 재발화.
 *   값 변경 0(재확정만) → enqueue 가 daily_closings 확정 구성분(package_*+single_*) 으로 total 재계산:
 *     (1) revision<NEW.revision(=rev0) 전건 UPDATE superseded=true
 *     (2) 신규 rev1 INSERT superseded=false + total_amount_krw = daily_closings actual + INV5 통과
 *   단일 DO 블록(원자 txn) — 실패 시 마감확정 상태 미훼손(전부 롤백).
 *
 * ── 08-06 ─────────────────────────────────────────────────────────────────────
 *   08-06 은 daily_closings 에 closed 행 부재(과거 close 후 reopen/삭제·outbox 만 잔존) → reopen→reconfirm
 *   불가. 08-06 정정 = 현장 정규 EOD 마감(신 코드로 자동 정합 emit) = 별도 ops(본 러너 대상 아님·SKIP 로그).
 *
 * usage: node scripts/reemit_20260806150000_totals_recompute_port.mjs          (DRY — pre-state 실측만)
 *        node scripts/reemit_20260806150000_totals_recompute_port.mjs --apply  (재emit 실행 + POSTCHECK)
 * author: dev-foot / 2026-08-06
 */
import { query } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(재emit 실행)' : 'DRY(pre-state 실측만)';
const SLUG = 'jongno-foot';
const DATES = ['2026-08-04', '2026-08-05']; // 08-06 = closed 행 부재 → 정규 EOD 마감으로 정합(SKIP)
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };
const scalar = async (sql) => { const o = (await rows(sql))[0] || {}; return o[Object.keys(o)[0]]; };

const outboxState = () => rows(`
  SELECT o.close_date::text AS close_date, o.revision, o.superseded, o.dlq, o.status,
         (o.payload->>'total_amount_krw') AS total_krw
    FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id = o.clinic_id
   WHERE c.slug = '${SLUG}' AND o.close_date IN ('2026-08-04','2026-08-05','2026-08-06')
   ORDER BY o.close_date, o.revision;`);

const dcState = () => rows(`
  SELECT dc.close_date::text AS close_date, dc.revision, dc.status,
    (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)+COALESCE(dc.package_cash_total,0)
    +COALESCE(dc.single_cash_total,0)+COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)) AS sys_total
    FROM public.daily_closings dc JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE c.slug = '${SLUG}' AND dc.close_date IN ('2026-08-04','2026-08-05','2026-08-06')
   ORDER BY dc.close_date;`);

const readerVisible = (date) => scalar(`
  SELECT e.revision FROM public.read_closing_confirmed_events(NULL, NULL, 5000) e
   WHERE e.clinic_slug = '${SLUG}' AND (e.payload->>'close_date') = '${date}'
   ORDER BY e.revision DESC LIMIT 1;`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] TOTALS-RECOMPUTE-PORT 재emit — ${SLUG} ${DATES.join(', ')} (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

console.log('── PRE-STATE (outbox) ──');
for (const o of await outboxState())
  console.log(`  ${o.close_date} rev${o.revision}: superseded=${o.superseded} status=${o.status} dlq=${o.dlq} total_krw=${o.total_krw}`);
console.log('── PRE-STATE (daily_closings) ──');
for (const d of await dcState()) console.log(`  ${d.close_date}: revision=${d.revision} status=${d.status} sys_total=${d.sys_total}`);
console.log('── PRE-STATE (리더 가시 revision) ──');
for (const date of [...DATES, '2026-08-06']) console.log(`  ${date}: reader sees rev=${await readerVisible(date)}`);
console.log('');

if (!APPLY) {
  console.log('DRY 종료. 실행: node scripts/reemit_20260806150000_totals_recompute_port.mjs --apply');
  console.log('★선결: 마이그 20260806150000 prod APPLY 완료(supervisor) 후에만 실행.');
  console.log('★08-06: daily_closings closed 행 부재 → 정규 EOD 마감으로 정합(본 러너 SKIP).');
  process.exit(0);
}

// ── 재emit 실행 (per-date 원자 DO 블록: STEP A 해제 → STEP B 재확정) ──
for (const date of DATES) {
  console.log(`── 재emit ${date} (정당경로: unlock→reconfirm, confirm_guard revision+1 + enqueue) ──`);
  await query(`
DO $reemit$
DECLARE
  v_id      uuid;
  v_old_rev int;
  v_new_rev int;
BEGIN
  SELECT dc.id, dc.revision INTO v_id, v_old_rev
    FROM public.daily_closings dc JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE c.slug = '${SLUG}' AND dc.close_date = DATE '${date}' AND dc.status = 'closed'
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'reemit ${date}: closed 마감 미발견 (재emit 불가 — 정규 EOD 마감 필요)';
  END IF;

  -- STEP A: 해제(closed→open) — unconfirmed_at set → confirm_guard else-branch(revision 불변·enqueue 미발화)
  UPDATE public.daily_closings
     SET status = 'open', unconfirmed_at = now(),
         unconfirm_reason = 'reemit TOTALS-RECOMPUTE-PORT(20260806150000) — dev-foot operational, T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT',
         updated_at = now()
   WHERE id = v_id;

  -- STEP B: 재확정(open→closed·값 변경 0) — confirm_guard: OLD.unconfirmed_at NOT NULL → revision+1
  --   + enqueue_closing_confirmed(AFTER) 재발화 → total=daily_closings 확정합 + 구 rev supersede + 신 rev superseded=false
  UPDATE public.daily_closings
     SET status = 'closed', closed_at = now(), updated_at = now()
   WHERE id = v_id;

  SELECT revision INTO v_new_rev FROM public.daily_closings WHERE id = v_id;
  IF v_new_rev <> v_old_rev + 1 THEN
    RAISE EXCEPTION 'reemit ${date}: revision bump 실패 (% -> %, expected %)', v_old_rev, v_new_rev, v_old_rev + 1;
  END IF;
  RAISE NOTICE 'reemit ${date}: revision % -> %', v_old_rev, v_new_rev;
END
$reemit$;`);
  console.log(`  ✅ ${date} 재확정 완료 (revision+1 + enqueue 재발화)\n`);
}

// ── POSTCHECK ──
console.log('── POSTCHECK (재emit 후 실측) ──\n');
const post = await outboxState();
console.log('(a) outbox post-state:');
for (const o of post)
  console.log(`  ${o.close_date} rev${o.revision}: superseded=${o.superseded} status=${o.status} dlq=${o.dlq} total_krw=${o.total_krw}`);
console.log('');

console.log('(b) daily_closings post-state + payload total == sys_total 대조:');
const dc = await dcState();
let allOk = true;
const evidence = [];
for (const date of DATES) {
  const d = dc.find((x) => x.close_date === date);
  const newRev = post.filter((o) => o.close_date === date).reduce((m, o) => Math.max(m, o.revision), -1);
  const newRow = post.find((o) => o.close_date === date && o.revision === newRev);
  const visible = await readerVisible(date);
  const oldSuperseded = post.filter((o) => o.close_date === date && o.revision < newRev).every((o) => o.superseded === true);
  const totalMatch = newRow && String(newRow.total_krw) === String(d?.sys_total);
  const ok = newRow && newRow.superseded === false && newRow.status !== 'failed' && newRow.dlq === false
    && totalMatch && visible === newRev && oldSuperseded;
  if (!ok) allOk = false;
  evidence.push({
    close_date: date, daily_closings_sys_total: d?.sys_total, new_rev: newRev,
    new_total_krw: newRow?.total_krw, total_match: totalMatch, status: newRow?.status, dlq: newRow?.dlq,
    new_superseded: newRow?.superseded, old_all_superseded: oldSuperseded, reader_visible_rev: visible, pass: ok,
  });
  console.log(`  ${date}: sys=${d?.sys_total} | newRev${newRev} total=${newRow?.total_krw} match=${totalMatch} status=${newRow?.status} dlq=${newRow?.dlq} sup=${newRow?.superseded} | reader=rev${visible} | old_sup=${oldSuperseded}  ${ok ? '✅' : '❌'}`);
}
console.log('');
console.log('(c) 08-06: daily_closings closed 행 부재 → 정규 EOD 마감으로 정합(SKIP·신 코드 자동 정합)\n');

console.log('── EVIDENCE (supervisor 사후검증용) ──');
console.log(JSON.stringify({ reemit_at: nowKst(), slug: SLUG, dates: DATES, evidence, all_pass: allOk, note_0806: 'daily_closings closed 행 부재 → 정규 EOD 마감 시 신 코드 자동 정합' }, null, 2));
console.log('');
console.log(allOk ? '✅ ALL PASS — 재emit 성공 (총액=daily_closings actual 원단위 일치·INV5 통과·리더 신 rev 가시·구 rev supersede)'
                  : '❌ 일부 실패 — supervisor 회신 전 확인 필요');
process.exit(allOk ? 0 : 1);
