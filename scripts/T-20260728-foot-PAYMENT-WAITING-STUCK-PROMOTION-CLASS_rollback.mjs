/**
 * T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS — ROLLBACK (완전 가역)
 *
 * _apply.mjs 가 남긴 rollback_manifest 를 읽어 각 PK 를 apply 前 상태로 복원:
 *   - check_ins.status = 'payment_waiting' (원복), completed_at = NULL (원복)
 *   - apply 가 INSERT 한 status_transitions 감사행 삭제(inserted id 기준)
 *   - 멱등: 이미 payment_waiting 이면 skip. done 인 것만 되돌림.
 *
 * 실행: node scripts/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_rollback.mjs
 *   (읽기전 DRY-RUN: ROLLBACK=1 없으면 투영만)
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
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const MANIFEST = 'db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_rollback_manifest.json';
const DO = process.env.ROLLBACK === '1';
const log = (...a) => console.log(...a);

async function main() {
  if (!fs.existsSync(MANIFEST)) { console.error(`❌ manifest 없음: ${MANIFEST} (apply 미실행)`); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  log(`\n=== ROLLBACK ${DO ? '[EXECUTE]' : '[DRY-RUN]'} — ${m.entries.length}건 (apply=${m.applied_at}) ===`);

  let ok = 0;
  for (const e of m.entries) {
    if (!DO) {
      log(`   ${e.check_in_id.slice(0, 8)} → status=payment_waiting, completed_at=NULL, del st_id=${e.inserted_status_transition_id ?? '(없음)'}`);
      continue;
    }
    const { data: upd, error: uErr } = await db
      .from('check_ins')
      .update({ status: 'payment_waiting', completed_at: null })
      .eq('id', e.check_in_id)
      .eq('status', 'done')   // 멱등: apply 로 done 된 것만
      .select('id');
    if (uErr) { console.error(`❌ 원복 실패 ${e.check_in_id}: ${uErr.message}`); continue; }
    if (e.inserted_status_transition_id) {
      await db.from('status_transitions').delete().eq('id', e.inserted_status_transition_id);
    }
    if (upd && upd.length === 1) { ok++; log(`   ✅ ${e.check_in_id.slice(0, 8)} 원복`); }
    else log(`   ⏭ ${e.check_in_id.slice(0, 8)} skip (이미 payment_waiting 이거나 상태 변동)`);
  }
  if (DO) log(`\n원복 완료: ${ok}/${m.entries.length}`);
  else log(`\n실행하려면: ROLLBACK=1 node scripts/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_rollback.mjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
