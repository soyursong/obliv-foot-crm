/**
 * T-20260702-foot-CANCEL-SENDER-ENV-WIRING — canary revert (guarded)
 *
 * supervisor GO 판정(qa=pass/green) 완료 → landed 증거 보존 종료 → canary 예약 원복.
 * 대상: canary 합성 예약(is_simulation=TRUE) 1건.
 *   UPDATE reservations SET status='confirmed', cancelled_at=NULL WHERE id=<CANARY>;
 * 가드: pre-read(존재+is_simulation 확인) → UPDATE → rows-affected===1 강제 → post-verify.
 *   rows-affected≠1 이면 ABORT(멱등/오검 방지).
 * mig 20260803120000(CHECK +cancelled)은 원복 대상 아님 — canary만.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const e = readFileSync('.env.local', 'utf8');
const p = (k) => (e.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1] ?? '').trim();
const URL = p('VITE_SUPABASE_URL') || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = p('SUPABASE_SERVICE_ROLE_KEY');
if (!KEY) { console.error('ABORT: SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(2); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const ID = '2fb4885d-7a96-4881-8859-c0645724ea75';

// ── [A] pre-read ──
// NOTE: foot reservations 에는 is_simulation 컬럼이 없음. synthetic 신원은
//   memo '[CANARY ...]' + external_id 'e2e...c301' fingerprint 로 확증(더 강한 가드).
const { data: pre, error: preErr } = await sb
  .from('reservations')
  .select('id,status,cancelled_at,cancel_reason,memo,external_id,customer_name')
  .eq('id', ID);
if (preErr) { console.error('ABORT pre-read fail:', preErr.message); process.exit(3); }
console.log('## [A] pre-read'); console.log(JSON.stringify(pre, null, 2));
if (!pre || pre.length !== 1) { console.error(`ABORT: canary row count=${pre?.length} (expect 1)`); process.exit(4); }
const isCanary = /CANARY/i.test(pre[0].memo || '') && /^e2e/i.test(pre[0].external_id || '');
if (!isCanary) { console.error('ABORT: synthetic canary fingerprint 불일치 — 원복 거부'); process.exit(5); }

// ── [B] guarded UPDATE ──
const { data: upd, error: updErr } = await sb
  .from('reservations')
  .update({ status: 'confirmed', cancelled_at: null, cancel_reason: null })
  .eq('id', ID)
  .select('id,status,cancelled_at,cancel_reason');
if (updErr) { console.error('ABORT update fail:', updErr.message); process.exit(6); }
const rows = upd?.length ?? 0;
console.log('## [B] update  rows-affected =', rows);
if (rows !== 1) { console.error(`ABORT: rows-affected=${rows} (expect 1)`); process.exit(7); }

// ── [C] post-verify ──
console.log('## [C] post-verify'); console.log(JSON.stringify(upd, null, 2));
const r = upd[0];
const ok = r.status === 'confirmed' && r.cancelled_at === null;
console.log(ok ? '✅ CANARY REVERT OK (rows-affected=1, status=confirmed, cancelled_at=NULL)' : '❌ post-verify mismatch');
process.exit(ok ? 0 : 8);
