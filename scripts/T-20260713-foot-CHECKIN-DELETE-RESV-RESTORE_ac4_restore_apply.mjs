/**
 * T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE — AC4 stuck-set 복구 러너
 *
 * 범위(scope expanded, MSG-20260713-163732): 단일 환자 → 전체 deleteCheckIn stuck 셋.
 * fingerprint: reservations.status='checked_in' AND NOT EXISTS(check_ins.reservation_id=r.id) AND clinic=jongno-foot
 * 복구값: reservations.status='confirmed' (기존 enum 재사용, ADDITIVE, 스키마 무접점).
 *
 * 안전 가드 (data_correction_backfill_sop 준수):
 *   1) blind bulk UPDATE 금지 — freeze 파일(evidence/..._ac4_freeze.json)에 고정된
 *      candidate_real_restore_target_ids 만 대상. count 기준 아님.
 *   2) 더미 배제 — freeze 시점에 dummy_seed/test/fixture 24건 제외 완료(이 러너는 후보만 받음).
 *   3) apply 직전 freeze-set 재검증 — 각 id 가 여전히 (status='checked_in' AND check_ins 무연결)
 *      인지 재확인. 하나라도 drift(이미 confirmed/다른상태/check_ins 재생성)면 그 id skip + 로그.
 *   4) 멱등 UPDATE — .eq('id', id).eq('status','checked_in') 로 스코프. 전역/무조건 UPDATE 금지.
 *   5) rollback — apply 시 실제 변경된 id 목록을 _ac4_rollback_applied.json 로 기록(원상=checked_in).
 *
 * 게이트: 기본 dry-run. 실제 write 는 supervisor 확인 게이트 통과 후 `--apply`.
 *   node scripts/T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE_ac4_restore_apply.mjs            # dry-run
 *   node scripts/T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE_ac4_restore_apply.mjs --apply     # supervisor gate 후
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');

const FREEZE = 'evidence/T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE_ac4_freeze.json';
const frozen = JSON.parse(fs.readFileSync(FREEZE, 'utf8'));
const targetIds = frozen.candidate_real_restore_target_ids;
console.log(`== AC4 restore ${APPLY ? '[APPLY]' : '[DRY-RUN]'} == candidate target=${targetIds.length}`);

const applied = [];
const skipped = [];
for (const id of targetIds) {
  // 가드3: freeze-set 재검증 (drift abort per-row)
  const { data: r, error: re } = await sb
    .from('reservations').select('id, status, customer_name, reservation_date').eq('id', id).maybeSingle();
  if (re) { console.error(`ABORT read ${id}: ${re.message}`); process.exit(2); }
  if (!r) { skipped.push({ id, reason: 'reservation_gone' }); continue; }
  if (r.status !== 'checked_in') { skipped.push({ id, reason: `drift_status=${r.status}`, name: r.customer_name }); continue; }
  const { count } = await sb.from('check_ins').select('id', { count: 'exact', head: true }).eq('reservation_id', id);
  if ((count ?? 0) > 0) { skipped.push({ id, reason: `drift_checkin_reappeared=${count}`, name: r.customer_name }); continue; }

  if (!APPLY) { applied.push({ id, name: r.customer_name, date: r.reservation_date, action: 'WOULD_restore->confirmed' }); continue; }

  // 가드4: 멱등 스코프 UPDATE
  const { data: upd, error: ue } = await sb
    .from('reservations').update({ status: 'confirmed' })
    .eq('id', id).eq('status', 'checked_in').select('id');
  if (ue) { console.error(`ABORT update ${id}: ${ue.message}`); process.exit(2); }
  if ((upd?.length ?? 0) > 0) applied.push({ id, name: r.customer_name, date: r.reservation_date, action: 'restored->confirmed' });
  else skipped.push({ id, reason: 'idempotent_no_change', name: r.customer_name });
}

console.log(`\n결과: ${APPLY ? 'restored' : 'would_restore'}=${applied.length}, skipped=${skipped.length}`);
applied.forEach(a => console.log(`  ✓ ${a.name} [${a.date}] ${a.action} ${a.id}`));
skipped.forEach(s => console.log(`  ⤫ skip ${s.name ?? ''} (${s.reason}) ${s.id}`));

if (APPLY && applied.length) {
  // 가드5: rollback ledger
  fs.writeFileSync('evidence/T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE_ac4_rollback_applied.json',
    JSON.stringify({ note: 'rollback: set these ids status back to checked_in', ids: applied.map(a => a.id) }, null, 2));
  console.log('\nrollback ledger -> evidence/..._ac4_rollback_applied.json');
}
