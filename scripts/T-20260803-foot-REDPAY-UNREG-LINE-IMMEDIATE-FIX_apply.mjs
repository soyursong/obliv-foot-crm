/**
 * T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST §IMMEDIATE-FIX
 *   현장(최필경 총괄, C0ATE5P6JTH) 확인 완료 — digest 기능과 독립·선행 처리.
 *
 * 무엇: 가맹점 1777289007 "오블리브-서울오리진점 풋(멀티)" 의 등록 회선(TID)을
 *   구 회선 1047479481(OL, 2026-07-20 종료) → 신 회선 1047538243(2026-08-03 교체) 로 remap.
 *   ★ 파괴 아님: 신 TID 를 active tid 로 승격하고 구 TID 는 superseded_tids 로 보존한다.
 *     membership(=tid ∪ unnest(superseded_tids)) = {1047538243, 1047479481} 이 되어
 *     - 신 회선의 대기 거래가 정상 분류/적재되고,
 *     - 구 회선의 과거 거래도 계속 정합(false-alarm 0) 된다.
 *   → redpay_macstudio_poller / redpay-reconcile / watchdog 모두 동일 membership 소스(§R3 UNION)를
 *     읽으므로, 이 한 줄 remap 으로 세 경로가 동시에 정상화된다(거래 데이터 손실 아님, 매핑만 보정).
 *
 * db_change: false (DDL 없음 — 기존 registry 행 1건 데이터 UPDATE). 파괴 변경 아님(autonomy §3.1).
 *
 * usage: node scripts/T-20260803-foot-REDPAY-UNREG-LINE-IMMEDIATE-FIX_apply.mjs           # DRY (before + 계획)
 *        node scripts/T-20260803-foot-REDPAY-UNREG-LINE-IMMEDIATE-FIX_apply.mjs --apply    # 실적용 + after 검증
 *
 * rollback SQL (수동, 이상 시):
 *   UPDATE public.redpay_terminal_registry
 *     SET tid='1047479481', superseded_tids=NULL, updated_at=now()
 *     WHERE merchant_id='1777289007' AND tid='1047538243' AND domain='foot';
 *
 * author: dev-foot / 2026-08-03
 */
import { query } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';

const MERCHANT = '1777289007';
const OLD_TID = '1047479481'; // OL, 7/20 종료
const NEW_TID = '1047538243'; // 8/3 교체(라이브)

const rowsOf = (r) => (Array.isArray(r) ? r : []);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] §IMMEDIATE-FIX — merchant ${MERCHANT} 회선 remap ${OLD_TID} → ${NEW_TID}`);
console.log('  ref rxlomoozakkjesdqjtvd (obliv-foot-crm prod)');
console.log('════════════════════════════════════════════════════════════\n');

// ── [precheck] 테이블 실재 ─────────────────────────────────────────────────
const reg = rowsOf(await query("SELECT to_regclass('public.redpay_terminal_registry') AS v;"))[0]?.v;
console.log(`── [precheck] redpay_terminal_registry = ${reg ?? 'ABSENT'}`);
if (!reg) { console.error('⛔ ABORT — registry 테이블 부재.'); process.exit(4); }

// ── [before] 대상 행 스냅샷 ────────────────────────────────────────────────
const before = rowsOf(await query(
  `SELECT merchant_id, tid, superseded_tids, terminal_label, active, domain
     FROM public.redpay_terminal_registry
    WHERE merchant_id='${MERCHANT}' ORDER BY tid;`
));
console.log('── [before] merchant 행:');
for (const r of before) console.log(`     merchant=${r.merchant_id} tid=${r.tid} superseded=${JSON.stringify(r.superseded_tids)} active=${r.active} label=${r.terminal_label}`);

// ── freeze-set 재검증: 정확히 구 TID 1행(active)이어야 안전 ──────────────────
const target = before.filter((r) => r.tid === OLD_TID && r.active && r.domain === 'foot');
const alreadyNew = before.some((r) => r.tid === NEW_TID);
const supersededHasNew = before.some((r) => Array.isArray(r.superseded_tids) && r.superseded_tids.includes(NEW_TID));

if (alreadyNew || supersededHasNew) {
  console.log(`\n✅ NO-OP — 신 TID ${NEW_TID} 가 이미 registry(tid 또는 superseded)에 존재. 이미 정상화됨. 종료.`);
  process.exit(0);
}
if (target.length !== 1) {
  console.error(`\n⛔ ABORT — 예상과 다름: merchant ${MERCHANT} 의 active foot 행 중 tid=${OLD_TID} 인 행이 ${target.length}건(기대 1). 수동 확인 필요.`);
  process.exit(3);
}

const UPDATE_SQL =
  `UPDATE public.redpay_terminal_registry
      SET tid='${NEW_TID}',
          superseded_tids = (COALESCE(superseded_tids, ARRAY[]::text[]) || ARRAY['${OLD_TID}']::text[]),
          updated_at = now()
    WHERE merchant_id='${MERCHANT}' AND tid='${OLD_TID}' AND domain='foot' AND active=true;`;

if (!APPLY) {
  console.log('\n── [DRY] 적용 계획 (1행 remap, 파괴 아님 — 구 TID 는 superseded 보존):');
  console.log(UPDATE_SQL.split('\n').map((l) => '    ' + l.trim()).join('\n'));
  console.log('\n실적용: --apply 플래그.\n');
  process.exit(0);
}

// ── APPLY ──────────────────────────────────────────────────────────────────
console.log('\n▶ APPLY remap …');
await query(UPDATE_SQL);

// ── [after] 검증 ───────────────────────────────────────────────────────────
const after = rowsOf(await query(
  `SELECT merchant_id, tid, superseded_tids, terminal_label, active, domain
     FROM public.redpay_terminal_registry
    WHERE merchant_id='${MERCHANT}' ORDER BY tid;`
));
console.log('── [after] merchant 행:');
for (const r of after) console.log(`     merchant=${r.merchant_id} tid=${r.tid} superseded=${JSON.stringify(r.superseded_tids)} active=${r.active} label=${r.terminal_label}`);

const ok = after.length === 1
  && after[0].tid === NEW_TID
  && Array.isArray(after[0].superseded_tids)
  && after[0].superseded_tids.includes(OLD_TID)
  && after[0].active === true;

// membership 확인(=tid ∪ superseded) 이 두 TID 모두 포함
const membership = new Set();
for (const r of after) { if (r.tid) membership.add(r.tid); for (const s of (r.superseded_tids ?? [])) membership.add(s); }
const coversBoth = membership.has(NEW_TID) && membership.has(OLD_TID);

console.log(`\n── [verify] active tid=${after[0]?.tid} (기대 ${NEW_TID})`);
console.log(`── [verify] membership(tid∪superseded) = {${[...membership].join(', ')}} — 신·구 모두 포함=${coversBoth}`);
console.log(ok && coversBoth ? '\n✅ [DONE] 회선 remap 정상화 완료 — 대기 거래는 다음 폴러 사이클(≤300s)에 정상 분류.' : '\n⛔ 검증 실패 — 수동 확인 필요.');
process.exit(ok && coversBoth ? 0 : 3);
