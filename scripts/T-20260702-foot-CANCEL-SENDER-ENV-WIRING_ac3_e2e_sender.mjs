/**
 * T-20260702-foot-CANCEL-SENDER-ENV-WIRING — AC3 e2e 자동 sender 경로 구동 (1회)
 *
 * supervisor NEW-TASK (MSG-20260803-134633-uiuz) — 사전승인 GO.
 *   canary 예약 2fb4885d... 를 정상 취소 동선으로 PATCH status=cancelled →
 *   foot sender EF `dopamine-callback`(type='cancelled') 자동 발화 →
 *   도파민 `crm-cancel-callback` 인증 수신 착지. receiver-direct 우회 없음.
 *
 * 증거 캡처:
 *   AC1: dopamine_outbound_log[event_id=2fb4885d, type=cancelled] → status='sent' + http 2xx
 *        ('skipped'/'failed'/'DOPAMINE_CANCEL_URL_NOT_SET' → env 미활성 = AC1 미충족)
 *   AC2: sender 가 받은 crm-cancel-callback HTTP 응답 = 2xx (401 아님)
 *   AC3: callback 응답 body applied:true (receiver 착지 proxy)
 *
 * 인증: FE 취소 동선 미러. DB update(service-role, PATCH) + EF invoke(사용자 JWT).
 *       사용자 JWT = 임시 QA auth 유저(service-role admin 생성) 로그인 → 사후 삭제.
 *       ※ receiver(dopamine crm-cancel-callback)를 직접 부르지 않음 — foot sender EF 만 호출.
 * 멱등: 선행 sent/pending 0 확인 후 1회만.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const RESV_ID = '2fb4885d-7a96-4881-8859-c0645724ea75';

// ── env 로드 (.env.local anon + process env service) ────────────────────
const envLocal = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pick = (k) => (envLocal.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1] ?? '').trim();
const SUPA_URL = pick('VITE_SUPABASE_URL') || process.env.SUPABASE_CRM_FOOT_URL;
const ANON_KEY = pick('VITE_SUPABASE_ANON_KEY');
// 신규 secret 키 우선(레거시 JWT service_role 은 프로젝트에서 disabled).
const SERVICE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_CRM_FOOT_SERVICE;
if (!SUPA_URL || !ANON_KEY || !SERVICE_KEY) { console.error('env 누락 (URL/ANON/SERVICE)'); process.exit(2); }

const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
const line = (...a) => console.log(...a);

// ── 0) 사전조건: canary 예약 상태 ───────────────────────────────────────
line('\n=== [0] 사전조건 (canary 예약) ===');
const { data: resv, error: rerr } = await admin
  .from('reservations')
  .select('id, external_id, source_system, status, cancelled_at, customer_id, memo')
  .eq('id', RESV_ID)
  .single();
if (rerr || !resv) { console.error('ABORT: canary 예약 조회 실패:', rerr?.message); process.exit(1); }
line(JSON.stringify(resv, null, 2));
if (!resv.external_id) { console.error('ABORT: external_id 없음 → not_dopamine_source (sender 미발화)'); process.exit(1); }

// is_simulation guard (실환자 blind 취소 금지)
const { data: cust } = await admin.from('customers').select('id, is_simulation, phone, name').eq('id', resv.customer_id).single();
line(`[guard] customer is_simulation=${cust?.is_simulation} phone=${cust?.phone} name=${cust?.name}`);
if (cust?.is_simulation !== true) { console.error('ABORT: 대상 고객 is_simulation !== true → 실환자 취소 위험, 중단'); process.exit(1); }

// ── 1) 멱등성: 선행 sent/pending 0 확인 ─────────────────────────────────
line('\n=== [1] 멱등성 (선행 sent/pending) ===');
const { data: prior } = await admin
  .from('dopamine_outbound_log')
  .select('id, status, http_status, created_at')
  .eq('callback_type', 'cancelled')
  .eq('event_id', RESV_ID);
line(`선행 로그 ${prior?.length ?? 0}건: ${JSON.stringify(prior)}`);
const blocking = (prior ?? []).filter((r) => r.status === 'sent' || r.status === 'pending');
if (blocking.length) { console.error(`ABORT: 선행 sent/pending ${blocking.length}건 존재 → 멱등 재발화 차단 (재실행 안전 위반)`); process.exit(1); }

// ── 2) 정상 취소 동선: DB PATCH status=cancelled (FE update 미러) ────────
line('\n=== [2] PATCH status=cancelled (정상 취소 동선) ===');
const cancelledAt = new Date().toISOString();
const { data: upd, error: uerr } = await admin
  .from('reservations')
  .update({ status: 'cancelled', cancelled_at: cancelledAt, cancel_reason: 'AC3 e2e canary (supervisor 사전승인)' })
  .eq('id', RESV_ID)
  .select('id, status, cancelled_at, external_id')
  .single();
if (uerr) { console.error('ABORT: PATCH 실패:', uerr.message); process.exit(1); }
line(`PATCH OK: status=${upd.status} cancelled_at=${upd.cancelled_at}`);

// ── 3) 사용자 JWT 확보 (임시 QA auth 유저) ──────────────────────────────
line('\n=== [3] 사용자 JWT (임시 QA 유저) ===');
const qaEmail = `qa.ac3cancel.${Date.now()}@medibuilder-qa.local`;
const qaPassword = `Ac3-${randomUUID()}`;
const { data: created, error: cerr } = await admin.auth.admin.createUser({
  email: qaEmail, password: qaPassword, email_confirm: true, user_metadata: { name: 'AC3취소QA(임시)' },
});
if (cerr) { console.error('ABORT: 임시 유저 생성 실패:', cerr.message); process.exit(1); }
const qaUid = created.user.id;
line(`임시 유저 생성: ${qaEmail} uid=${qaUid}`);

const anon = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: authData, error: aerr } = await anon.auth.signInWithPassword({ email: qaEmail, password: qaPassword });
if (aerr || !authData?.session?.access_token) {
  console.error('ABORT: 로그인 실패:', aerr?.message);
  await admin.auth.admin.deleteUser(qaUid).catch(() => {});
  process.exit(1);
}
const accessToken = authData.session.access_token;
line(`로그인 OK → user access_token 확보 (len=${accessToken.length})`);

// ── 4) sender EF 호출 (FE fire-and-forget invoke 미러, raw fetch) ───────
line('\n=== [4] foot sender EF dopamine-callback (type=cancelled) 호출 ===');
const efUrl = `${SUPA_URL}/functions/v1/dopamine-callback`;
let ac2Status = null, ac3Body = null, respText = '';
try {
  const res = await fetch(efUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ type: 'cancelled', reservation_id: RESV_ID }),
  });
  ac2Status = res.status;
  respText = await res.text();
  try { ac3Body = JSON.parse(respText); } catch { ac3Body = respText; }
  line(`[AC2] sender EF HTTP status = ${ac2Status}`);
  line(`[AC3] sender EF response body = ${respText}`);
} catch (e) {
  console.error('sender EF fetch 오류:', String(e));
} finally {
  await admin.auth.admin.deleteUser(qaUid).catch((e) => line('임시 유저 삭제 경고:', String(e)));
  line('임시 QA 유저 삭제 완료');
}

// ── 5) AC1: dopamine_outbound_log 최종 상태 ─────────────────────────────
line('\n=== [5] AC1: dopamine_outbound_log 최종 ===');
const { data: finalLog } = await admin
  .from('dopamine_outbound_log')
  .select('id, callback_type, event_id, external_id, status, http_status, response_body, attempts, last_attempt_at')
  .eq('callback_type', 'cancelled')
  .eq('event_id', RESV_ID)
  .order('created_at', { ascending: false });
line(JSON.stringify(finalLog, null, 2));

// ── 판정 ────────────────────────────────────────────────────────────────
const log0 = finalLog?.[0];
const ac1 = log0?.status === 'sent' && log0?.http_status >= 200 && log0?.http_status < 300;
const ac2 = ac2Status >= 200 && ac2Status < 300;
const ac3 = ac3Body && typeof ac3Body === 'object' && ac3Body.applied === true;

line('\n=== 판정 ===');
line(`AC1 (outbound_log sent + 2xx): ${ac1 ? 'PASS' : 'FAIL'}  [status=${log0?.status} http=${log0?.http_status}]`);
line(`AC2 (sender resp 2xx, not 401): ${ac2 ? 'PASS' : 'FAIL'}  [http=${ac2Status}]`);
line(`AC3 (resp applied:true): ${ac3 ? 'PASS' : 'FAIL'}  [applied=${ac3Body?.applied} dopamine_status=${ac3Body?.dopamine_status}]`);
line(`\nOVERALL: ${ac1 && ac2 && ac3 ? 'ALL PASS ✅' : 'NOT ALL PASS — supervisor 회신 필요'}`);
line(`\nROLLBACK SQL (원복 필요시): UPDATE reservations SET status='confirmed', cancelled_at=NULL WHERE id='${RESV_ID}';`);
process.exit(ac1 && ac2 && ac3 ? 0 : 3);
