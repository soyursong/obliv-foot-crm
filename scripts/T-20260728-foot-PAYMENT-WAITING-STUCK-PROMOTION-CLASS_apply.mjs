/**
 * T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS — APPLY (기본 DRY-RUN)
 *
 * DA GO_WARN(CONSULT-REPLY MSG-8fb8 Q3) + data_correction_backfill_sop §3 준수:
 *   - freeze셋 = probe 가 산출한 명시 PK VALUES(_freeze.json), 시간윈도우 술어 아님(§0-2-a).
 *   - apply 직전 재검증 abort: 각 PK 가 스냅샷 지문(status='payment_waiting' AND completed_at IS NULL)을
 *     유지하는지 재확인, 1건이라도 drift 시 전량 abort(write 0). (§3 / §0-2-a)
 *   - 멱등 WHERE: UPDATE ... WHERE id=PK AND status='payment_waiting' (재실행/경합 안전).
 *   - rows-affected 검증: PK 당 정확히 1행. 불일치 시 즉시 중단.
 *   - completed_at 교정: reconciled payment일 우선, 폴백 checked_in_at (DA 지시).
 *   - status_transitions 감사행 INSERT(정상 승격 경로 PaymentDialog.tsx:664 mirror).
 *   - 롤백 manifest 기록(before-value per-PK) → _rollback.mjs 완전 가역.
 *   - 원장 무접점: DDL 0 · schema_migrations 무관 · customers.visit_type 미접점(직교축, §3-3-a).
 *
 * 실행:
 *   DRY-RUN (기본, prod write 0):  node scripts/..._apply.mjs
 *   APPLY   (supervisor DB 게이트 + 사람 confirm 後):
 *           APPLY=1 node scripts/..._apply.mjs --confirm <FREEZE_SHA>
 *   ※ FREEZE_SHA 는 dry-run 출력에 표시됨. freeze 파일이 바뀌면 SHA 가 바뀌어 apply 거부.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const FREEZE_FILE = 'db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_freeze.json';
const APPLY = process.env.APPLY === '1';
const args = process.argv.slice(2);
const confirmSha = args.includes('--confirm') ? args[args.indexOf('--confirm') + 1] : null;
const log = (...a) => console.log(...a);

async function main() {
  if (!fs.existsSync(FREEZE_FILE)) { console.error(`❌ freeze 파일 없음: ${FREEZE_FILE} — probe 먼저 실행`); process.exit(1); }
  const freezeDoc = JSON.parse(fs.readFileSync(FREEZE_FILE, 'utf8'));
  const freeze = freezeDoc.freeze;
  const FREEZE_SHA = crypto.createHash('sha256').update(JSON.stringify(freeze.map((f) => f.check_in_id).sort())).digest('hex').slice(0, 12);

  log(`\n=== T-20260728 payment_waiting 승격 백필 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ===`);
  log(`freeze PK 수: ${freeze.length}`);
  log(`FREEZE_SHA  : ${FREEZE_SHA}`);

  // ── 1. apply 직전 재검증 (§3 / §0-2-a) — drift 1건이라도 있으면 전량 abort ──
  log('\n── [1] apply 직전 재검증 (지문: status=payment_waiting AND completed_at IS NULL) ──');
  const drift = [];
  const ready = [];
  for (const f of freeze) {
    const { data: ci, error } = await db.from('check_ins').select('id,status,completed_at,clinic_id,customer_id,checked_in_at').eq('id', f.check_in_id).maybeSingle();
    if (error) { console.error('❌ 재검증 조회 실패:', error.message); process.exit(1); }
    if (!ci) { drift.push({ pk: f.check_in_id, reason: 'row_absent' }); continue; }
    if (ci.status !== 'payment_waiting') { drift.push({ pk: f.check_in_id, reason: `status=${ci.status} (expected payment_waiting)` }); continue; }
    if (ci.completed_at !== null) { drift.push({ pk: f.check_in_id, reason: `completed_at already set (${ci.completed_at})` }); continue; }
    ready.push({ ...f, clinic_id: ci.clinic_id, customer_id: ci.customer_id, checked_in_at: ci.checked_in_at });
  }
  if (drift.length > 0) {
    log(`\n⛔ ABORT — freeze 지문 drift ${drift.length}건 (write 0):`);
    for (const d of drift) log(`   ${d.pk}: ${d.reason}`);
    log('\n→ probe 재실행으로 freeze 재산출 필요. apply 중단.');
    process.exit(2);
  }
  log(`  ✅ 재검증 통과: ${ready.length}/${freeze.length} 지문 일치, drift 0`);

  // ── 2. DRY-RUN 투영 or APPLY ──
  if (!APPLY) {
    log('\n── [2] DRY-RUN 투영 (prod write 0) ──');
    for (const r of ready) {
      log(`   ${r.check_in_id.slice(0, 8)} → status=done, completed_at=${r.completed_at_corrected}`);
    }
    log(`\n예상 rows-affected: ${ready.length} (check_ins) + ${ready.length} (status_transitions INSERT)`);
    log(`\nAPPLY 하려면: APPLY=1 node scripts/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_apply.mjs --confirm ${FREEZE_SHA}`);
    fs.writeFileSync('db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_dryrun_evidence.json',
      JSON.stringify({ mode: 'dry-run', generated_at: new Date().toISOString(), freeze_sha: FREEZE_SHA, revalidate_pass: ready.length, drift: 0, projected_updates: ready }, null, 2));
    log('📄 dryrun evidence → db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_dryrun_evidence.json');
    return;
  }

  // ── APPLY 게이트: confirm token ──
  if (confirmSha !== FREEZE_SHA) {
    console.error(`\n⛔ APPLY 거부 — confirm token 불일치.\n  기대: --confirm ${FREEZE_SHA}\n  받음: --confirm ${confirmSha ?? '(없음)'}`);
    process.exit(3);
  }

  log('\n── [2] APPLY (per-PK 멱등 UPDATE + rows-affected 검증 + status_transitions INSERT) ──');
  const rollbackManifest = { ticket: 'T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS', applied_at: new Date().toISOString(), freeze_sha: FREEZE_SHA, entries: [] };
  let ok = 0;
  for (const r of ready) {
    // before-value 캡처 (rollback 근거) — 재검증에서 status=payment_waiting, completed_at=null 확정됨
    const before = { check_in_id: r.check_in_id, status: 'payment_waiting', completed_at: null };

    // 멱등 UPDATE (WHERE 지문 재포함) + returning
    const { data: upd, error: uErr } = await db
      .from('check_ins')
      .update({ status: 'done', completed_at: r.completed_at_corrected })
      .eq('id', r.check_in_id)
      .eq('status', 'payment_waiting')   // 멱등·경합 가드
      .is('completed_at', null)
      .select('id');
    if (uErr) { console.error(`❌ UPDATE 실패 ${r.check_in_id}: ${uErr.message} — 중단(부분적용). rollback manifest 부분 기록됨.`); break; }
    if (!upd || upd.length !== 1) {
      console.error(`❌ rows-affected=${upd?.length ?? 0} (기대 1) — ${r.check_in_id} drift 의심. 중단.`);
      break;
    }

    // status_transitions 감사행 (정상 승격 경로 mirror)
    const { data: st, error: sErr } = await db.from('status_transitions').insert({
      check_in_id: r.check_in_id, clinic_id: r.clinic_id,
      from_status: 'payment_waiting', to_status: 'done',
      changed_by: null, transitioned_at: r.completed_at_corrected,
    }).select('id');
    const stId = (!sErr && st && st[0]) ? st[0].id : null;

    rollbackManifest.entries.push({ ...before, restored_completed_at: null, inserted_status_transition_id: stId, applied_completed_at: r.completed_at_corrected });
    ok++;
    log(`   ✅ ${r.check_in_id.slice(0, 8)} done, completed_at=${r.completed_at_corrected}, st_id=${stId ?? 'insert실패(비치명)'}`);
  }

  const rbFile = 'db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_rollback_manifest.json';
  fs.writeFileSync(rbFile, JSON.stringify(rollbackManifest, null, 2));
  log(`\n적용 완료: ${ok}/${ready.length}`);
  log(`📄 rollback manifest → ${rbFile}`);
  fs.writeFileSync('db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_apply_evidence.json',
    JSON.stringify({ mode: 'apply', applied_at: rollbackManifest.applied_at, freeze_sha: FREEZE_SHA, rows_affected_check_ins: ok, rows_affected_status_transitions: rollbackManifest.entries.filter((e) => e.inserted_status_transition_id).length }, null, 2));
  log('📄 apply evidence → db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_apply_evidence.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
