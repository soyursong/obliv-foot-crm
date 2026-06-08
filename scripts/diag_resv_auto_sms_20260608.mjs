/**
 * T-20260608-foot-RESV-AUTO-SMS-NOFIRE (P1) — 예약 시 자동 SMS 미발송 원인 절단 (READ-ONLY)
 *
 * "트리거 자체가 없음" vs "트리거는 있으나 차단됨" 을 DB 증거로 절단.
 * 실행: node scripts/diag_resv_auto_sms_20260608.mjs
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function q(label, sql, params=[]) {
  try {
    const r = await client.query(sql, params);
    console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
    console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.log(`\n=== ${label} === ERROR: ${e.message}`);
    return null;
  }
}

try {
  await client.connect();
  console.log('connected to rxlomoozakkjesdqjtvd');

  // 1. 트리거 존재 여부
  await q('1. reservations 트리거', `
    SELECT trigger_name, event_manipulation, action_timing, action_statement
    FROM information_schema.triggers
    WHERE event_object_table='reservations'
    ORDER BY trigger_name`);

  // 2. 트리거 함수 존재 여부
  await q('2. notify_reservation_messaging 함수', `
    SELECT proname, pronargs
    FROM pg_proc WHERE proname IN ('notify_reservation_messaging','notify_reminders_batch','notify_retry_failed')`);

  // 3. pg_net / pg_cron 확장 설치 여부
  await q('3. 확장(pg_net/pg_cron/http)', `
    SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_net','pg_cron','http')`);

  // 4. vault secrets 존재 여부 (값 노출 X, 이름만)
  await q('4. vault secrets (이름만)', `
    SELECT name, (decrypted_secret IS NOT NULL AND length(decrypted_secret)>0) AS has_value
    FROM vault.decrypted_secrets
    WHERE name IN ('supabase_project_url','internal_cron_secret','supabase_anon_key')
    ORDER BY name`);

  // 5. clinic_messaging_capability — 발송 활성/설정
  await q('5. clinic_messaging_capability', `
    SELECT clinic_id, enabled, solapi_validation_status, sender_number,
           (solapi_api_key_vault_name IS NOT NULL) AS has_apikey_vault,
           send_start_hour, send_end_hour
    FROM clinic_messaging_capability`);

  // 6. 최근 예약 (최근 24h INSERT) — 트리거 발화 대상
  await q('6. 최근 예약 10건', `
    SELECT id, clinic_id, customer_id, status, created_at
    FROM reservations ORDER BY created_at DESC LIMIT 10`);

  // 7. 최근 notification_logs — resv_confirm 발화 증거 (트리거가 pending log 적재하는가)
  await q('7. 최근 notification_logs 15건', `
    SELECT id, event_type, status, channel, recipient_phone, error_message, created_at
    FROM notification_logs ORDER BY created_at DESC LIMIT 15`);

  // 8. resv_confirm 로그 통계 (status 분포)
  await q('8. resv_confirm 로그 status 분포', `
    SELECT event_type, status, count(*)
    FROM notification_logs
    GROUP BY event_type, status ORDER BY event_type, status`);

  // 9. pg_net 응답 큐 최근 (HTTP 호출 실제 발생/응답 여부) — 테이블 존재 시
  await q('9. net._http_response 최근 10건', `
    SELECT id, status_code, content_type, left(content,200) AS content, created
    FROM net._http_response ORDER BY created DESC LIMIT 10`);

  // 10. notification_templates — resv_confirm 템플릿 매핑
  await q('10. notification_templates', `
    SELECT clinic_id, event_type, channel, is_active, left(body,40) AS body_preview
    FROM notification_templates ORDER BY event_type`);

  // 11. [결정적] 라이브 트리거 함수 정의 — 발화 조건(status) 확인
  //     ※ repo migration 20260525(원본 'reserved') → 20260527(override 'confirmed')
  //       라이브는 'confirmed'에서 발화해야 정상 (풋 CRM 기본 status='confirmed')
  try {
    const fn = await client.query(`SELECT pg_get_functiondef('public.notify_reservation_messaging'::regproc) AS def`);
    const def = fn.rows[0].def;
    const cond = (def.match(/NEW\.status = '(\w+)'/g) || []).join(', ');
    console.log(`\n=== 11. 라이브 트리거 발화 조건 ===\n  ${cond}  (← 'confirmed'면 정상)`);
  } catch (e) { console.log('11. fn def ERR:', e.message); }

  // 12. 트리거 미발화 의심: 최근 40h 예약 중 resv_confirm 로그 없는 건
  await q('12. 트리거 미발화 의심(로그 없는 예약, 0이어야 정상)', `
    SELECT r.status, count(*) AS resv_no_sms
    FROM reservations r
    LEFT JOIN notification_logs n ON n.reservation_id=r.id AND n.event_type='resv_confirm'
    WHERE r.created_at > now()-interval '40 hours' AND n.id IS NULL
    GROUP BY r.status`);

} catch (e) {
  console.error('FATAL', e.message);
} finally {
  await client.end();
}
