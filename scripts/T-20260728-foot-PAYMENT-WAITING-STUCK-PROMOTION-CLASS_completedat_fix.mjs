/**
 * T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS — completed_at 교정 (forward corrective)
 *
 * 배경 (supervisor QA NO-GO, MSG-20260802-032246-beby):
 *   최초 apply(_apply.mjs)가 status+completed_at 을 동일 UPDATE 로 세팅 →
 *   check_ins BEFORE UPDATE 트리거 trg_set_completed_at(set_completed_at)의
 *   "status → done" 분기가 NEW.completed_at := NOW() 로 무조건 덮어씀(clobber).
 *   결과: 29건 completed_at = apply실행시각(2026-08-01T18:14:59~18:15:04),
 *   DA 명시 교정값(payment일/checked_in_at)이 아님.
 *
 * 이 스크립트 (전체 롤백 금지 — status=done 승격은 정상):
 *   completed_at 만 2-step 보정.
 *   1) 대상 PK 는 이미 status='done'. completed_at-only UPDATE(status 미변경) →
 *      트리거 두 분기 모두 미발화(OLD.status='done' ∧ NEW.status='done'):
 *        분기1: NEW.status='done' AND OLD.status IS DISTINCT FROM 'done' → FALSE(OLD=done)
 *        분기2: NEW.status IS DISTINCT FROM 'done' AND OLD.status='done' → FALSE(NEW=done)
 *      ⇒ NEW.completed_at(교정값) 보존. (HEO-4717 단건 선례 = status/completed_at 2-step 분리)
 *   2) 교정값 = rollback_manifest.json entries[].applied_completed_at (freeze_sha 8b66b388bfe6).
 *   3) rows-affected=1/PK 가드. 불일치 시 즉시 중단.
 *   4) post-verify: check_ins.completed_at == 교정값 AND == status_transitions.transitioned_at(정합화 확인).
 *   5) status 미변경 → 승격/status_transitions 무접점. 매출(payments) 무접점. DDL 0.
 *
 * 실행:
 *   DRY-RUN (기본, prod write 0):  node scripts/..._completedat_fix.mjs
 *   APPLY (supervisor 게이트 後):   APPLY=1 node scripts/..._completedat_fix.mjs --confirm 8b66b388bfe6
 */
import { createClient } from '@supabase/supabase-js';
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
if (!URL.includes('rxlomoozakkjesdqjtvd')) { console.error(`❌ prod project 아님: ${URL}`); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const MANIFEST_FILE = 'db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_rollback_manifest.json';
const EXPECT_FREEZE_SHA = '8b66b388bfe6';
const APPLY = process.env.APPLY === '1';
const args = process.argv.slice(2);
const confirmSha = args.includes('--confirm') ? args[args.indexOf('--confirm') + 1] : null;
const log = (...a) => console.log(...a);

// 최초 apply 실행시각 창(=clobber 지문). 이 창 안이면 아직 미교정(교정 필요).
const CLOBBER_LO = Date.parse('2026-08-01T18:14:50.000Z');
const CLOBBER_HI = Date.parse('2026-08-01T18:15:20.000Z');

async function main() {
  if (!fs.existsSync(MANIFEST_FILE)) { console.error(`❌ manifest 없음: ${MANIFEST_FILE}`); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  if (manifest.freeze_sha !== EXPECT_FREEZE_SHA) {
    console.error(`❌ freeze_sha 불일치: ${manifest.freeze_sha} (기대 ${EXPECT_FREEZE_SHA}) — manifest 오염 의심. 중단.`);
    process.exit(1);
  }
  const targets = manifest.entries.map((e) => ({ pk: e.check_in_id, corrected: e.applied_completed_at }));
  log(`\n=== T-20260728 completed_at 교정 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ===`);
  log(`manifest freeze_sha: ${manifest.freeze_sha}`);
  log(`대상 PK 수         : ${targets.length}`);

  // ── [1] pre-verify: status='done' 확인 + 현재 completed_at 분류(clobbered/already-corrected/other) ──
  log('\n── [1] pre-verify (status=done 확인 + 현 completed_at 진단) ──');
  const ready = [];
  const abort = [];
  let alreadyCorrect = 0;
  for (const t of targets) {
    const { data: ci, error } = await db.from('check_ins')
      .select('id,status,completed_at').eq('id', t.pk).maybeSingle();
    if (error) { console.error('❌ 조회 실패:', error.message); process.exit(1); }
    if (!ci) { abort.push({ pk: t.pk, reason: 'row_absent' }); continue; }
    if (ci.status !== 'done') { abort.push({ pk: t.pk, reason: `status=${ci.status} (기대 done — 승격 미완/변조)` }); continue; }
    const curMs = ci.completed_at ? Date.parse(ci.completed_at) : null;
    const isCorrected = ci.completed_at && Date.parse(ci.completed_at) === Date.parse(t.corrected);
    const isClobbered = curMs !== null && curMs >= CLOBBER_LO && curMs <= CLOBBER_HI;
    if (isCorrected) { alreadyCorrect++; continue; } // 멱등: 이미 교정됨
    if (!isClobbered) {
      // clobber 창 밖 + 교정값도 아님 → 예상외 값. 안전상 중단.
      abort.push({ pk: t.pk, reason: `completed_at=${ci.completed_at} (clobber창·교정값 둘다 아님)` });
      continue;
    }
    ready.push({ ...t, before_completed_at: ci.completed_at });
  }
  if (abort.length > 0) {
    log(`\n⛔ ABORT — 예상외 상태 ${abort.length}건 (write 0):`);
    for (const a of abort) log(`   ${a.pk}: ${a.reason}`);
    process.exit(2);
  }
  log(`  ✅ status=done 전건 확인. 교정대상(clobbered)=${ready.length}, 이미교정(멱등skip)=${alreadyCorrect}, 총=${targets.length}`);
  if (ready.length === 0) { log('\n교정할 대상 없음(전건 이미 교정됨). 종료.'); }

  // ── [2] DRY-RUN 투영 or APPLY ──
  if (!APPLY) {
    log('\n── [2] DRY-RUN 투영 (prod write 0) ──');
    for (const r of ready) log(`   ${r.pk.slice(0, 8)}: ${r.before_completed_at} → ${r.corrected}`);
    log(`\n예상 rows-affected: ${ready.length} (check_ins completed_at-only, status 미변경)`);
    log(`APPLY 하려면: APPLY=1 node scripts/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_completedat_fix.mjs --confirm ${EXPECT_FREEZE_SHA}`);
    return;
  }
  if (confirmSha !== EXPECT_FREEZE_SHA) {
    console.error(`\n⛔ APPLY 거부 — confirm token 불일치.\n  기대: --confirm ${EXPECT_FREEZE_SHA}\n  받음: --confirm ${confirmSha ?? '(없음)'}`);
    process.exit(3);
  }

  // ── [3] APPLY: completed_at-only UPDATE (status 미변경 → 트리거 미발화) ──
  log('\n── [3] APPLY (completed_at-only UPDATE, WHERE status=done) ──');
  const applied = [];
  for (const r of ready) {
    const { data: upd, error: uErr } = await db.from('check_ins')
      .update({ completed_at: r.corrected })   // status 미포함 → 트리거 두 분기 모두 미발화
      .eq('id', r.pk)
      .eq('status', 'done')                     // 멱등·경합 가드(status 변조 시 0-row → 중단)
      .select('id');
    if (uErr) { console.error(`❌ UPDATE 실패 ${r.pk}: ${uErr.message} — 중단(부분적용).`); break; }
    if (!upd || upd.length !== 1) { console.error(`❌ rows-affected=${upd?.length ?? 0} (기대 1) — ${r.pk} drift 의심. 중단.`); break; }
    applied.push(r);
    log(`   ✅ ${r.pk.slice(0, 8)} completed_at ${r.before_completed_at} → ${r.corrected}`);
  }

  // ── [4] post-verify: check_ins.completed_at == 교정값 AND == status_transitions.transitioned_at ──
  log('\n── [4] post-verify (completed_at == 교정값 == status_transitions.transitioned_at) ──');
  const verify = [];
  for (const t of targets) {
    const { data: ci } = await db.from('check_ins').select('id,status,completed_at').eq('id', t.pk).maybeSingle();
    const { data: sts } = await db.from('status_transitions')
      .select('transitioned_at,to_status').eq('check_in_id', t.pk).eq('to_status', 'done')
      .order('transitioned_at', { ascending: false }).limit(1);
    const st = sts && sts[0] ? sts[0] : null;
    const ciMatch = ci && ci.completed_at && Date.parse(ci.completed_at) === Date.parse(t.corrected);
    const stMatch = st && st.transitioned_at && Date.parse(st.transitioned_at) === Date.parse(t.corrected);
    const ciEqSt = ci && st && ci.completed_at && st.transitioned_at && Date.parse(ci.completed_at) === Date.parse(st.transitioned_at);
    verify.push({ pk: t.pk, status: ci?.status, completed_at: ci?.completed_at, corrected: t.corrected,
      st_transitioned_at: st?.transitioned_at, ci_match_corrected: !!ciMatch, st_match_corrected: !!stMatch, ci_eq_st: !!ciEqSt });
  }
  const bad = verify.filter((v) => !v.ci_match_corrected || v.status !== 'done' || !v.ci_eq_st);
  log(`  대상 ${verify.length}건 | completed_at==교정값 ${verify.filter((v) => v.ci_match_corrected).length} | ci==st정합 ${verify.filter((v) => v.ci_eq_st).length} | status=done ${verify.filter((v) => v.status === 'done').length}`);
  if (bad.length > 0) {
    log(`\n⚠️ post-verify 불일치 ${bad.length}건:`);
    for (const b of bad) log(`   ${b.pk}: status=${b.status} completed_at=${b.completed_at} corrected=${b.corrected} st=${b.st_transitioned_at}`);
  } else {
    log('  ✅ 전건 정합: completed_at==교정값==status_transitions.transitioned_at, status=done 유지');
  }

  const ev = {
    mode: 'apply',
    corrective_of: 'completed_at_correction_clobbered_by_trigger',
    applied_at: manifest.applied_at, // 원 apply 시각(참조)
    corrected_at_note: 'completed_at-only 2-step; per-PK NOW() 미사용',
    freeze_sha: EXPECT_FREEZE_SHA,
    rows_affected: applied.length,
    already_correct_idempotent_skip: alreadyCorrect,
    total_targets: targets.length,
    post_verify_pass: bad.length === 0,
    post_verify_ci_match_corrected: verify.filter((v) => v.ci_match_corrected).length,
    post_verify_ci_eq_st: verify.filter((v) => v.ci_eq_st).length,
    verify,
  };
  fs.writeFileSync('db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_completedat_fix_evidence.json', JSON.stringify(ev, null, 2));
  log('\n📄 evidence → db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_completedat_fix_evidence.json');
  log(`\n적용 완료: ${applied.length} 교정 + ${alreadyCorrect} 멱등skip / 총 ${targets.length}. post-verify ${bad.length === 0 ? 'PASS' : 'FAIL(' + bad.length + ')'}`);
  if (bad.length > 0) process.exit(4);
}

main().catch((e) => { console.error(e); process.exit(1); });
