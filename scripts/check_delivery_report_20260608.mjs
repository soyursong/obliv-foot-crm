/**
 * MSG-20260608-170230-smstest — 전달 리포트 최종 상태 조회 (READ-ONLY, 발송 없음)
 * accepted(2000) vs delivered/failed 절단. 오늘 예약 message_id + 테스트 message_id.
 */
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const { Client } = pg;

const env = {};
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')) { const m=l.match(/^([A-Z_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim(); }
const DB_PASSWORD = env.SUPABASE_DB_PASSWORD;

const client = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false} });

async function report(apiKey, apiSecret, messageId) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g,'');
  const sig = crypto.createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex');
  const auth = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}`;
  const res = await fetch(`https://api.solapi.com/messages/v4/list?messageId=${encodeURIComponent(messageId)}`, { headers:{Authorization:auth} });
  const j = await res.json().catch(()=>({}));
  return j?.messageList?.[messageId] || null;
}

(async () => {
  await client.connect();
  const cap = (await client.query(`SELECT solapi_api_key_vault_name k, solapi_secret_vault_name s FROM clinic_messaging_capability WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'`)).rows[0];
  const apiKey = (await client.query(`SELECT decrypted_secret v FROM vault.decrypted_secrets WHERE name=$1`,[cap.k])).rows[0].v;
  const apiSecret = (await client.query(`SELECT decrypted_secret v FROM vault.decrypted_secrets WHERE name=$1`,[cap.s])).rows[0].v;

  const rows = (await client.query(`
    SELECT solapi_message_id mid, event_type, recipient_phone, status, sent_at
    FROM notification_logs
    WHERE solapi_message_id IS NOT NULL AND created_at > now() - interval '40 hours'
    ORDER BY created_at DESC LIMIT 12`)).rows;

  console.log('\n=== Solapi 최종 전달 리포트 (status/statusCode/reason) ===');
  const out = [];
  for (const r of rows) {
    const m = await report(apiKey, apiSecret, r.mid);
    out.push({
      event: r.event_type,
      phone: r.recipient_phone,
      db_status: r.status,
      solapi_status: m?.status ?? 'NOT_FOUND',
      statusCode: m?.statusCode ?? '-',
      reason: (m?.reason || m?.statusMessage || '').trim().slice(0,40),
      type: m?.type ?? '-',
      dateReceived: m?.dateReceived ?? null,
    });
  }
  console.table(out);
  await client.end();
})().catch(e=>{console.error(e);process.exit(1);});
