/**
 * MSG-20260608-170230-smstest — 이광현 팀장 요청: 01035690462 테스트 SMS 발송
 * 부모티켓: T-20260608-foot-RESV-AUTO-SMS-NOFIRE / linked: T-20260608-foot-SMS-EF-DEPLOY-VERIFY
 *
 * 목적:
 *  1) send-notification EF 직접 호출(test_sms) → 실 발송 (실수신 검증용)
 *  2) Solapi v4 RAW 응답 캡처(groupInfo/failedMessageList) → accepted-vs-delivered 절단
 *     (EF는 boolean만 반환하여 groupInfo를 가려서, root 진단을 위해 직접 호출도 병행)
 *  3) notification_logs 적재 확인 (message_id/status/channel)
 *  4) 오늘 예약 message_id의 Solapi 전달 리포트 조회
 *
 * 실행: node scripts/test_sms_smoke_01035690462_20260608.mjs
 */
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const { Client } = pg;

const TEST_PHONE = '01035690462';

// ── .env 로드 ─────────────────────────────────────────────
const env = {};
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
}
const DB_PASSWORD   = process.env.SUPABASE_DB_PASSWORD   || env.SUPABASE_DB_PASSWORD;
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL  = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
if (!DB_PASSWORD || !SERVICE_ROLE || !SUPABASE_URL) {
  console.error('❌ SUPABASE_DB_PASSWORD / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_URL 필요');
  process.exit(1);
}

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function q(label, sql, params = []) {
  try {
    const r = await client.query(sql, params);
    console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
    if (r.rows.length) console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.log(`\n=== ${label} === ERROR: ${e.message}`);
    return null;
  }
}

function getChannel(body) {
  return Buffer.byteLength(body, 'utf8') <= 90 ? 'SMS' : 'LMS';
}

// EF의 sendSolapi와 동일한 v4 호출 (RAW 응답 전체 캡처)
async function sendSolapiRaw({ apiKey, apiSecret, senderNumber, recipientPhone, body }) {
  const type = getChannel(body);
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const signature = crypto.createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex');
  const authHdr = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  const payload = {
    message: {
      to: recipientPhone.replace(/[^0-9]/g, ''),
      from: senderNumber.replace(/[^0-9]/g, ''),
      text: body,
      type,
    },
  };
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHdr },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, payloadType: type, raw: json, auth: { apiKeyTail: apiKey.slice(-4) } };
}

// Solapi 전달 리포트 (메시지 단건 조회)
async function solapiDeliveryReport({ apiKey, apiSecret, messageId }) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const signature = crypto.createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex');
  const authHdr = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  const url = `https://api.solapi.com/messages/v4/list?messageId=${encodeURIComponent(messageId)}`;
  const res = await fetch(url, { headers: { Authorization: authHdr } });
  return { httpStatus: res.status, raw: await res.json().catch(() => ({})) };
}

(async () => {
  await client.connect();
  console.log('connected to rxlomoozakkjesdqjtvd\n');
  console.log(`### 테스트 대상 번호: ${TEST_PHONE} (이광현 팀장)`);

  // 1. 운영 클리닉 capability
  const caps = await q('1. clinic_messaging_capability (운영 클리닉)', `
    SELECT c.id AS clinic_id, c.name, cmc.enabled, cmc.sender_number,
           cmc.solapi_validation_status, cmc.send_start_hour, cmc.send_end_hour,
           cmc.solapi_api_key_vault_name, cmc.solapi_secret_vault_name
    FROM clinic_messaging_capability cmc
    JOIN clinics c ON c.id = cmc.clinic_id
    WHERE cmc.enabled = true
    ORDER BY c.name`);

  if (!caps || !caps.length) { console.error('❌ enabled capability 없음'); await client.end(); return; }
  // jongno-foot 오리진점 우선 선택
  const cap = caps.find(r => /오리진|jongno|서울/.test(r.name)) || caps[0];
  console.log(`\n>>> 선택 클리닉: ${cap.name} (${cap.clinic_id}) / sender=${cap.sender_number} / validation_status=${cap.solapi_validation_status}`);

  // 2. vault 시크릿 조회 (값 일부만 노출)
  const sec = await q('2. vault secret 존재 여부', `
    SELECT name, (decrypted_secret IS NOT NULL AND length(decrypted_secret)>0) AS has_value,
           right(decrypted_secret, 4) AS tail
    FROM vault.decrypted_secrets
    WHERE name IN ($1, $2)`, [cap.solapi_api_key_vault_name, cap.solapi_secret_vault_name]);

  const keyRow = await client.query(
    `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1`, [cap.solapi_api_key_vault_name]);
  const secRow = await client.query(
    `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1`, [cap.solapi_secret_vault_name]);
  const apiKey = keyRow.rows[0]?.decrypted_secret;
  const apiSecret = secRow.rows[0]?.decrypted_secret;
  if (!apiKey || !apiSecret) { console.error('❌ vault 시크릿 누락'); await client.end(); return; }

  // 3. EF 직접 호출 (test_sms) — 실 프로덕션 경로
  console.log('\n=== 3. send-notification EF 직접 호출 (test_sms) ===');
  const efRes = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: SERVICE_ROLE,
    },
    body: JSON.stringify({ _action: 'test_sms', clinic_id: cap.clinic_id, recipient_phone: TEST_PHONE }),
  });
  const efJson = await efRes.json().catch(() => ({}));
  console.log('EF HTTP status:', efRes.status);
  console.log('EF response   :', JSON.stringify(efJson));

  // 4. Solapi RAW 직접 호출 — groupInfo/failedMessageList 캡처 (accepted vs delivered)
  console.log('\n=== 4. Solapi v4 RAW 직접 호출 (groupInfo 캡처) ===');
  const testBody = `[오블리브 ${cap.name}] 문자 발송 테스트입니다. (진단 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`;
  const rawRes = await sendSolapiRaw({ apiKey, apiSecret, senderNumber: cap.sender_number, recipientPhone: TEST_PHONE, body: testBody });
  console.log('payload type :', rawRes.payloadType, '(body bytes:', Buffer.byteLength(testBody, 'utf8'), ')');
  console.log('HTTP status  :', rawRes.httpStatus);
  console.log('RAW response :', JSON.stringify(rawRes.raw, null, 2));
  const directMsgId = rawRes.raw?.messageId || rawRes.raw?.groupInfo?._id || null;

  // 5. 직접 호출분 notification_logs 적재 (요청: DB 기록 확인)
  const gi = rawRes.raw?.groupInfo;
  const directStatus = (rawRes.httpStatus === 200 && (rawRes.raw?.messageId || (gi?.count?.total > 0 && (gi?.count?.registeredFailed ?? 0) === 0))) ? 'sent' : 'failed';
  await q('5. notification_logs 적재 (직접 RAW 발송분)', `
    INSERT INTO notification_logs
      (clinic_id, customer_id, reservation_id, event_type, channel, recipient_phone, body_rendered, status, solapi_message_id, error_message, sent_at)
    VALUES ($1, NULL, NULL, 'test_send', $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, event_type, channel, status, solapi_message_id, error_message`,
    [cap.clinic_id, getChannel(testBody).toLowerCase(), TEST_PHONE, testBody, directStatus,
     directMsgId, directStatus === 'sent' ? 'diag_direct_raw' : `diag_direct_raw: ${JSON.stringify(rawRes.raw)?.slice(0, 300)}`,
     directStatus === 'sent' ? new Date().toISOString() : null]);

  // 6. EF가 적재한 test_send 로그 확인
  await q('6. notification_logs 최근 test_send/manual_send 5건', `
    SELECT id, event_type, channel, recipient_phone, status, solapi_message_id,
           left(error_message, 60) AS err, sent_at
    FROM notification_logs
    WHERE recipient_phone = $1
    ORDER BY created_at DESC LIMIT 5`, [TEST_PHONE]);

  // 7. 오늘 예약 auto-send message_id 전달 리포트 (accepted vs delivered)
  const todays = await q('7. 오늘 resv_confirm sent 로그 (message_id 보유)', `
    SELECT id, recipient_phone, solapi_message_id, status, sent_at
    FROM notification_logs
    WHERE event_type IN ('reservation_confirm','resv_confirm')
      AND solapi_message_id IS NOT NULL
      AND created_at > now() - interval '40 hours'
    ORDER BY created_at DESC LIMIT 5`);

  if (todays && todays.length) {
    console.log('\n=== 8. Solapi 전달 리포트 조회 (오늘 예약분) ===');
    for (const row of todays.slice(0, 3)) {
      const rep = await solapiDeliveryReport({ apiKey, apiSecret, messageId: row.solapi_message_id });
      const m = rep.raw?.[row.solapi_message_id] || Object.values(rep.raw || {})[0] || {};
      console.log(`- msgId=${row.solapi_message_id} → status=${m.status} statusCode=${m.statusCode} reason=${m.reason || m.statusMessage || ''} type=${m.type}`);
    }
  }

  // 새로 보낸 테스트 메시지 전달 리포트 (잠시 후 statusCode 확정되므로 즉시값만)
  if (directMsgId) {
    console.log('\n=== 9. 방금 보낸 테스트 메시지 전달 리포트 (즉시 조회) ===');
    const rep = await solapiDeliveryReport({ apiKey, apiSecret, messageId: directMsgId });
    console.log(JSON.stringify(rep.raw, null, 2));
  }

  await client.end();
  console.log('\n✅ done. (실수신 여부는 이광현 팀장 폰 확인)');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
