/**
 * reemit_20260804200000_rev2_jongno.mjs
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE — supersede-fix(20260804200000) 후속 rev2 재emit
 *
 * ── 배경 ──────────────────────────────────────────────────────────────────────
 *   마이그 20260804200000(enqueue supersede 방향 정상화)은 APPLY 완료(prod 실측: supersede-UPDATE
 *   present · self-supersede defect absent · ledger 등재 · anon-EXEC=0). 그러나 기존 outbox 행
 *   (jongno-foot 08-01/08-03 rev0/rev1)은 구 버그본이 적재한 역전 상태로 잔존:
 *     rev0 superseded=false(가시)·total=0(틀림)  /  rev1 superseded=true(불가시)·total=정답
 *   → 리더가 틀린 rev0(총 0) 을 읽음. 함수 교체만으로는 기존 행이 소급 정정되지 않음.
 *
 * ── 정당경로(legitimate path) ─────────────────────────────────────────────────
 *   raw outbox UPDATE(우회) 금지. daily_closings 확정 재발화(closing_confirmed_edit RPC 내부 동선과
 *   동형: STEP A 해제(closed→open, unconfirmed_at set) → STEP B 재확정(open→closed))로
 *   confirm_guard(revision+1) + enqueue_closing_confirmed(AFTER) 트리거를 재발화한다.
 *   값 변경 0(재확정만) → enqueue 가 fresh total 재계산하여:
 *     (1) revision<NEW.revision(=rev0,rev1) 전건 UPDATE superseded=true
 *     (2) 신규 rev2 INSERT superseded=false + total_amount_krw 정답
 *   두 UPDATE 는 단일 DO 블록(원자 txn) — 실패 시 마감확정 상태 미훼손(전부 롤백).
 *
 * usage: node scripts/reemit_20260804200000_rev2_jongno.mjs          (DRY — pre-state 실측만)
 *        node scripts/reemit_20260804200000_rev2_jongno.mjs --apply  (재emit 실행 + POSTCHECK)
 * author: dev-foot / 2026-08-04
 */
import { query } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(재emit 실행)' : 'DRY(pre-state 실측만)';
const SLUG = 'jongno-foot';
const DATES = ['2026-08-01', '2026-08-03'];
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };
const scalar = async (sql) => { const o = (await rows(sql))[0] || {}; return o[Object.keys(o)[0]]; };

const outboxState = () => rows(`
  SELECT o.close_date::text AS close_date, o.revision, o.superseded, o.dlq, o.status,
         (o.payload->>'total_amount_krw') AS total_krw
    FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id = o.clinic_id
   WHERE c.slug = '${SLUG}' AND o.close_date IN ('${DATES.join("','")}')
   ORDER BY o.close_date, o.revision;`);

const dcState = () => rows(`
  SELECT dc.close_date::text AS close_date, dc.revision, dc.status
    FROM public.daily_closings dc JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE c.slug = '${SLUG}' AND dc.close_date IN ('${DATES.join("','")}')
   ORDER BY dc.close_date;`);

// 리더 RPC 가 각 날짜에 대해 반환하는 revision (가시본) — dlq=false AND superseded=false 만 반환됨
// (반환 컬럼: event_id, clinic_slug, payload, revision, created_at)
const readerVisible = (date) => scalar(`
  SELECT e.revision FROM public.read_closing_confirmed_events(NULL, NULL, 5000) e
   WHERE e.clinic_slug = '${SLUG}' AND (e.payload->>'close_date') = '${date}'
   ORDER BY e.revision DESC LIMIT 1;`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] rev2 재emit — ${SLUG} ${DATES.join(', ')} (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

console.log('── PRE-STATE (outbox) ──');
for (const o of await outboxState())
  console.log(`  ${o.close_date} rev${o.revision}: superseded=${o.superseded} status=${o.status} dlq=${o.dlq} total_krw=${o.total_krw}`);
console.log('── PRE-STATE (daily_closings) ──');
for (const d of await dcState()) console.log(`  ${d.close_date}: revision=${d.revision} status=${d.status}`);
console.log('── PRE-STATE (리더 가시 revision) ──');
for (const date of DATES) console.log(`  ${date}: reader sees rev=${await readerVisible(date)}`);
console.log('');

if (!APPLY) {
  console.log('DRY 종료. 실행: node scripts/reemit_20260804200000_rev2_jongno.mjs --apply');
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
    RAISE EXCEPTION 'reemit ${date}: closed 마감 미발견 (재emit 불가)';
  END IF;

  -- STEP A: 해제(closed→open) — unconfirmed_at set → confirm_guard else-branch(revision 불변·enqueue 미발화)
  UPDATE public.daily_closings
     SET status = 'open', unconfirmed_at = now(),
         unconfirm_reason = 'reemit rev2 supersede-fix(20260804200000) 후속 — dev-foot operational, T-CLOSING-HERALD-PAYLOAD-RECONCILE',
         updated_at = now()
   WHERE id = v_id;

  -- STEP B: 재확정(open→closed·값 변경 0) — confirm_guard: OLD.unconfirmed_at NOT NULL → revision+1
  --   + enqueue_closing_confirmed(AFTER) 재발화 → 구 rev supersede + 신 rev superseded=false 적재
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
console.log('(a) outbox post-state:');
const post = await outboxState();
for (const o of post)
  console.log(`  ${o.close_date} rev${o.revision}: superseded=${o.superseded} status=${o.status} dlq=${o.dlq} total_krw=${o.total_krw}`);
console.log('');

console.log('(b) daily_closings post-state (revision=2 기대):');
for (const d of await dcState()) console.log(`  ${d.close_date}: revision=${d.revision} status=${d.status}`);
console.log('');

console.log('(c) 리더 가시본 검증 (rev2 가시·구 rev 불가시):');
let allOk = true;
const evidence = [];
for (const date of DATES) {
  const visible = await readerVisible(date);
  const rev2 = post.find((o) => o.close_date === date && o.revision === 2);
  const rev0 = post.find((o) => o.close_date === date && o.revision === 0);
  const rev1 = post.find((o) => o.close_date === date && o.revision === 1);
  const ok = visible === 2
    && rev2 && rev2.superseded === false
    && rev0 && rev0.superseded === true
    && rev1 && rev1.superseded === true;
  if (!ok) allOk = false;
  evidence.push({
    close_date: date, reader_visible_rev: visible,
    rev2: rev2 ? { superseded: rev2.superseded, total_krw: rev2.total_krw, status: rev2.status, dlq: rev2.dlq } : null,
    rev1_superseded: rev1 ? rev1.superseded : null,
    rev0_superseded: rev0 ? rev0.superseded : null,
    pass: ok,
  });
  console.log(`  ${date}: reader sees rev=${visible} | rev2.superseded=${rev2?.superseded} total=${rev2?.total_krw} | rev1.sup=${rev1?.superseded} rev0.sup=${rev0?.superseded}  ${ok ? '✅' : '❌'}`);
}
console.log('');

console.log('── EVIDENCE (supervisor 사후검증용) ──');
console.log(JSON.stringify({ reemit_at: nowKst(), slug: SLUG, dates: DATES, evidence, all_pass: allOk }, null, 2));
console.log('');
console.log(allOk ? '✅ ALL PASS — rev2 재emit 성공 (리더 가시본=rev2·구 rev supersede·foot enabled=true 자동발송 대기/진행)'
                  : '❌ 일부 실패 — supervisor 회신 전 확인 필요');
process.exit(allOk ? 0 : 1);
