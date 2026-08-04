/**
 * T-20260804-foot-CBAND-RESPRECV-BANNER-RCA — '카드 단말 결제 확인 필요' 배너 미해소 RCA
 * ════════════════════════════════════════════════════════════════════════════
 * NON-MUTATING(read-only). 어떤 write/rpc-mutating 도 실행하지 않는다.
 *
 * 목표: MSG_TRACE 558080127045 / 실카드 승인 29258831 의 CRM-측 영속 타임라인 재구성.
 *   - cband_payment_attempts 행의 status/auth_no/response_code/raw_response/created_at/updated_at/payment_id
 *   - payments 에 external_approval_no=29258831 (또는 payment_attempt_id 링크) 존재 여부
 *   → 배너(CbandAttemptRecap)는 status∈{attention, stale-requested} 일 때만 뜨고 approved/failed 면 사라짐.
 *   → 이 행의 실제 status 가 배너 잔존의 직접 원인이며, auth_no/payments 존재여부가 근본원인을 가른다.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MSG_TRACE = '558080127045';
const AUTHNO = '29258831';

function j(x) { return JSON.stringify(x, null, 2); }

console.log('════════════════════════════════════════════════════════════════');
console.log(' CBAND RESPRECV BANNER RCA — read-only');
console.log(`  MSG_TRACE=${MSG_TRACE}  AUTHNO(실카드 승인)=${AUTHNO}`);
console.log('════════════════════════════════════════════════════════════════\n');

// ── 1) 시도 레코드(cband_payment_attempts) — MSG_TRACE 로 조회 ──────────────────
console.log('=== 1) cband_payment_attempts WHERE msg_trace = MSG_TRACE ===');
const { data: att, error: attErr } = await sb
  .from('cband_payment_attempts')
  .select('id, clinic_id, check_in_id, customer_id, msg_trace, merno, tran_type, cat_tid, requested_amount, status, auth_no, response_code, payment_id, is_simulation, raw_response, created_at, updated_at')
  .eq('msg_trace', MSG_TRACE);
if (attErr) console.log('  ERROR:', attErr.code, attErr.message);
else console.log(`  rows=${att?.length ?? 0}\n`, j(att));

const row = att?.[0];

// ── 2) payments — external_approval_no = 실카드 승인번호 ────────────────────────
console.log('\n=== 2) payments WHERE external_approval_no = AUTHNO(실카드 승인) ===');
const { data: payByAuth, error: payErr } = await sb
  .from('payments')
  .select('id, check_in_id, customer_id, amount, method, payment_type, external_approval_no, external_tid, merchant_no, payment_attempt_id, accounting_date, is_simulation, created_at, memo')
  .eq('external_approval_no', AUTHNO);
if (payErr) console.log('  ERROR:', payErr.code, payErr.message);
else console.log(`  rows=${payByAuth?.length ?? 0}\n`, j(payByAuth));

// ── 3) payments — payment_attempt_id 링크(시도 id) ─────────────────────────────
if (row?.id) {
  console.log('\n=== 3) payments WHERE payment_attempt_id = attempt.id ===');
  const { data: payByAttempt, error: e3 } = await sb
    .from('payments')
    .select('id, amount, method, payment_type, external_approval_no, external_tid, payment_attempt_id, accounting_date, created_at')
    .eq('payment_attempt_id', row.id);
  if (e3) console.log('  ERROR:', e3.code, e3.message);
  else console.log(`  rows=${payByAttempt?.length ?? 0}\n`, j(payByAttempt));
}

// ── 4) 동일 check_in 의 코밴 시도 전체(중복/재시도 정황) ─────────────────────────
if (row?.check_in_id) {
  console.log('\n=== 4) 동일 check_in 의 코밴 시도 전체(시각순) ===');
  const { data: sib, error: e4 } = await sb
    .from('cband_payment_attempts')
    .select('id, msg_trace, tran_type, status, auth_no, response_code, requested_amount, payment_id, created_at, updated_at')
    .eq('check_in_id', row.check_in_id)
    .order('created_at', { ascending: true });
  if (e4) console.log('  ERROR:', e4.code, e4.message);
  else console.log(`  rows=${sib?.length ?? 0}\n`, j(sib));
}

// ── 5) 타임라인 해석 요약 ──────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════');
console.log(' 해석 힌트');
console.log('════════════════════════════════════════════════════════════════');
if (!row) {
  console.log('  · 시도 레코드 부재 → insert-first 실패 or 다른 clinic/trace. (RLS 아님: service_role)');
} else {
  const created = row.created_at, updated = row.updated_at;
  const gapMs = (Date.parse(updated) - Date.parse(created));
  console.log(`  · status=${row.status}  auth_no=${row.auth_no ?? 'NULL'}  response_code=${row.response_code ?? 'NULL'}  payment_id=${row.payment_id ?? 'NULL'}`);
  console.log(`  · raw_response=${row.raw_response ? '있음(응답 파싱 도달)' : 'NULL(응답 미파싱)'}`);
  console.log(`  · created=${created}  updated=${updated}  Δ=${Number.isNaN(gapMs) ? '?' : (gapMs/1000)+'s'}`);
  console.log('  판정 매트릭스:');
  console.log('    A) status=approved + payments 존재 → CRM 정상 수신·영속. 배너 원인은 별개(recap 미갱신 등).');
  console.log('    B) status=attention + auth_no/raw NULL → WS 응답 CRM 미도달(timedOut) → 데몬→CRM 전달 갭.');
  console.log('    C) status=attention + auth_no/raw 존재 → 응답은 파싱됐으나 approved 승격/수납 실패(핸들러/RLS).');
  console.log('    D) status=requested(고아) → 응답처리 전 중단(탭닫힘/언마운트/throw). = PAYRESULT-SWEEP tail-case 동일.');
}
