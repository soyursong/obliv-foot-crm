/**
 * T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED — 진단 (READ-ONLY, 무위험)
 *
 * 목표(planner 1단계 요청):
 *   Q1. 솔라피 풋센터 계정 일일 SMS 발송 한도
 *   Q2. 금일 사용량(발송 건수) — 한도 대비 소진율
 *   Q3. 한도가 (a)솔라피 계정/플랜 레벨인지 (b)CRM 어드민 발송 설정 내부 상한인지
 *   Q4. 솔라피 계정이 타 CRM과 공유인지 / 풋 전용인지 (from-number/senderid 분포로 추정)
 *
 * ⚠ 한도 상향·플랜 업그레이드·지원요청 등 비용/상태 변경 액션 절대 없음.
 *    모든 Solapi 호출은 GET(조회) 전용. DB는 SELECT 전용. Vault는 RPC read.
 *    (foot 도메인 격리 — foot DB만 접근, 타 CRM DB 미접근)
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// KST 오늘 경계 (foot 표준 Asia/Seoul)
const nowUtc = new Date();
const kstNow = new Date(nowUtc.getTime() + 9 * 3600 * 1000);
const kstDateStr = kstNow.toISOString().slice(0, 10); // YYYY-MM-DD (KST)
// KST 00:00 == UTC 전날 15:00
const kstMidnightUtc = new Date(`${kstDateStr}T00:00:00+09:00`);
console.log(`[진단 기준] now(UTC)=${nowUtc.toISOString()} / KST today=${kstDateStr} / KST00:00(UTC)=${kstMidnightUtc.toISOString()}\n`);

// ── foot 발송 설정(capability) 조회 — vault name / sender number ────────
const { data: caps, error: capErr } = await sb
  .from('clinic_messaging_capability')
  .select('clinic_id, enabled, sender_number, solapi_api_key_vault_name, solapi_secret_vault_name, solapi_validation_status, send_start_hour, send_end_hour');
if (capErr) { console.error('capability 조회 실패:', capErr.message); }
console.log('=== [Q3/Q4] foot clinic_messaging_capability (발송 설정) ===');
for (const c of (caps ?? [])) {
  console.log(`  clinic=${c.clinic_id} enabled=${c.enabled} sender=${c.sender_number} ` +
    `keyVault=${c.solapi_api_key_vault_name} validation=${c.solapi_validation_status} hours=${c.send_start_hour}~${c.send_end_hour}`);
}
console.log('  → CRM 코드에는 일일 발송 상한(내부 cap) 로직 없음 (send-notification EF grep 결과 0건).');
console.log('    게이트는 enabled/sender-validation/opt-out/opt-in/영업시간뿐 → Q3 답: (a) 솔라피 계정레벨 한도.\n');

const footSenders = [...new Set((caps ?? []).map(c => (c.sender_number || '').replace(/[^0-9]/g, '')).filter(Boolean))];

function makeAuth(apiKey, apiSecret) {
  return () => {
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const sig = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
    return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}`;
  };
}
async function solGet(path, authFn) {
  const res = await fetch(`https://api.solapi.com${path}`, { headers: { Authorization: authFn() } });
  const raw = await res.text();
  let body; try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: res.status, ok: res.ok, body };
}

// ── [Q2] CRM notification_logs — KST 오늘 발송 시도 집계 + 실패 사유 샘플 ──
const { data: logs, error: logErr } = await sb
  .from('notification_logs')
  .select('status, channel, event_type, error_message, created_at')
  .gte('created_at', kstMidnightUtc.toISOString());
console.log('=== [Q2] CRM notification_logs (KST 오늘, foot DB 기준) ===');
if (logErr) { console.error('  logs 조회 실패:', logErr.message); }
else {
  const byStatus = {}, byEvent = {}, failMsgDist = {};
  let firstFailTs = null, lastSentTs = null;
  for (const l of logs) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    byEvent[l.event_type] = (byEvent[l.event_type] ?? 0) + 1;
    if (l.status === 'failed') {
      const key = (l.error_message || '(null)').slice(0, 80);
      failMsgDist[key] = (failMsgDist[key] ?? 0) + 1;
      if (!firstFailTs || l.created_at < firstFailTs) firstFailTs = l.created_at;
    }
    if (l.status === 'sent') { if (!lastSentTs || l.created_at > lastSentTs) lastSentTs = l.created_at; }
  }
  console.log(`  총 로그 ${logs.length}건 | status 분포:`, JSON.stringify(byStatus));
  console.log(`  event_type 분포:`, JSON.stringify(byEvent));
  console.log(`  'sent' 처리 = ${byStatus['sent'] ?? 0}건 | 마지막 sent 시각(UTC)=${lastSentTs ?? '없음'}`);
  console.log(`  첫 failed 시각(UTC)=${firstFailTs ?? '없음'} (KST=${firstFailTs ? new Date(new Date(firstFailTs).getTime()+9*3600*1000).toISOString().slice(11,19) : '-'})`);
  console.log(`  === 실패 error_message 분포 (Q1/Q3 핵심 — 솔라피 원문 에러) ===`);
  for (const [msg, cnt] of Object.entries(failMsgDist).sort((a,b)=>b[1]-a[1])) {
    console.log(`    [${cnt}건] ${msg}`);
  }
  console.log('');
}

// ── 계정별 Solapi 조회 (GET 전용) — 두 clinic 계정 각각 ────────────────
for (const c of (caps ?? [])) {
  const kv = c.solapi_api_key_vault_name, sv = c.solapi_secret_vault_name;
  console.log(`\n════════ 계정 진단: clinic=${c.clinic_id} sender=${c.sender_number} vault=${kv} ════════`);
  const apiKey = (await sb.rpc('get_vault_secret', { p_name: kv })).data;
  const apiSecret = (await sb.rpc('get_vault_secret', { p_name: sv })).data;
  if (!apiKey || !apiSecret) { console.log(`  vault 키 조회 실패 (kv=${kv})`); continue; }
  const auth = makeAuth(apiKey, apiSecret);
  console.log(`  apiKeyPrefix=${String(apiKey).slice(0,8)} (Q4 계정 식별자)`);

  // [Q1] 잔액/계정
  const bal = await solGet('/cash/v1/balance', auth);
  console.log(`  [Q1 balance] status=${bal.status}`, JSON.stringify(bal.body));

  // [Q1] 계정 정보 (일일 한도 노출 여부)
  for (const p of ['/appstore/v1/me', '/account/v1/me']) {
    const r = await solGet(p, auth);
    console.log(`  [Q1 ${p}] status=${r.status}`, r.ok ? JSON.stringify(r.body)?.slice(0,600) : `(err ${JSON.stringify(r.body)?.slice(0,120)})`);
  }

  // [Q4] 등록 발신번호 목록
  const sender = await solGet('/senderid/v1/numbers', auth);
  if (sender.ok) {
    const list = Object.values(sender.body?.senderList ?? sender.body ?? {});
    const nums = list.map(s => (s?.phoneNumber || s?.number || '').replace(/[^0-9]/g,'')).filter(Boolean);
    const foreign = nums.filter(n => !footSenders.includes(n));
    console.log(`  [Q4 senderid] 등록번호 ${nums.length}개=${JSON.stringify(nums)} | foot외 ${foreign.length}개=${JSON.stringify(foreign)}`);
  } else {
    console.log(`  [Q4 senderid] status=${sender.status} err=`, JSON.stringify(sender.body)?.slice(0,200));
  }

  // [Q2/Q4] 오늘 발송 리스트
  const params = new URLSearchParams({ limit: '500', startDate: kstMidnightUtc.toISOString() });
  const lst = await solGet(`/messages/v4/list?${params}`, auth);
  if (lst.ok) {
    const msgs = Object.values(lst.body.messageList ?? {});
    const fromDist = {}, codeDist = {};
    for (const m of msgs) {
      const f = (m.from||'').replace(/[^0-9]/g,''); fromDist[f]=(fromDist[f]??0)+1;
      codeDist[`${m.statusCode}/${m.status}`] = (codeDist[`${m.statusCode}/${m.status}`]??0)+1;
    }
    const footCount = Object.entries(fromDist).filter(([f])=>footSenders.includes(f)).reduce((a,[,v])=>a+v,0);
    console.log(`  [Q2 list] 솔라피 오늘 발송기록=${msgs.length}건 (limit500) | foot발신=${footCount} 그외=${msgs.length-footCount}`);
    console.log(`    from 분포:`, JSON.stringify(fromDist));
    console.log(`    statusCode 분포:`, JSON.stringify(codeDist));
  } else {
    console.log(`  [Q2 list] status=${lst.status} err=`, JSON.stringify(lst.body)?.slice(0,200));
  }
}
console.log('\n[진단 완료] 모든 호출 read-only(GET/SELECT/Vault-read). 한도 상향/플랜 변경 미실행 (사람 게이트).');
