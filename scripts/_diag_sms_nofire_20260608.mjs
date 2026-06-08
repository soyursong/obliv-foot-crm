/**
 * T-20260608-foot-RESV-AUTO-SMS-NOFIRE + SMS-EF-DEPLOY-VERIFY — READ-ONLY 진단
 * 목표: manual+auto 둘 다 미발송, test_sms만 통과하는 공통 root 절단.
 *   (A) clinic_messaging_capability.enabled=false?  (test_sms는 enabled 미체크 → 통과, manual/auto 차단)
 *   (B) solapi_validation_status 실값 (not_registered? pending? active?)
 *   (C) 오늘 notification_logs 상태 분포 + manual_send/auto event_type별 error_message
 * 절대 write 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== (1) clinic_messaging_capability 전수 ===');
const { data: caps, error: capErr } = await sb
  .from('clinic_messaging_capability')
  .select('clinic_id, enabled, solapi_validation_status, sender_number, solapi_api_key_vault_name, solapi_secret_vault_name, send_start_hour, send_end_hour, updated_at');
if (capErr) { console.error('cap query err', capErr); }
else {
  for (const c of caps) {
    console.log(JSON.stringify({
      clinic_id: c.clinic_id,
      enabled: c.enabled,
      validation_status: c.solapi_validation_status,
      sender: c.sender_number,
      apiKeyVault: c.solapi_api_key_vault_name,
      secretVault: c.solapi_secret_vault_name,
      hours: `${c.send_start_hour}~${c.send_end_hour}`,
      updated_at: c.updated_at,
    }, null, 0));
  }
}

console.log('\n=== (2) clinics 이름 매핑 ===');
const { data: clinics } = await sb.from('clinics').select('id, name, slug');
for (const c of clinics ?? []) console.log(`  ${c.id}  ${c.name}  (${c.slug})`);

console.log('\n=== (3) 오늘(2026-06-08) notification_logs 상태분포 ===');
const since = '2026-06-08T00:00:00+09:00';
const { data: logs, error: logErr } = await sb
  .from('notification_logs')
  .select('id, event_type, channel, status, recipient_phone, solapi_message_id, error_message, created_at, sent_at')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(80);
if (logErr) { console.error('log query err', logErr); }
else {
  console.log(`총 ${logs.length}행`);
  const byKey = {};
  for (const l of logs) {
    const k = `${l.event_type}/${l.status}`;
    byKey[k] = (byKey[k] ?? 0) + 1;
  }
  console.log('분포:', JSON.stringify(byKey, null, 0));
  console.log('--- 상세 (최근 30) ---');
  for (const l of logs.slice(0, 30)) {
    console.log(`  ${l.created_at?.slice(5,16)} [${l.event_type}/${l.status}] msgId=${l.solapi_message_id ?? '-'} err=${l.error_message ?? '-'} phone=${l.recipient_phone}`);
  }
}

console.log('\n=== (4) 최근 7일 event_type별 상태 (auto/manual/test 비교) ===');
const since7 = '2026-06-01T00:00:00+09:00';
const { data: logs7 } = await sb
  .from('notification_logs')
  .select('event_type, status, created_at')
  .gte('created_at', since7);
const m = {};
for (const l of logs7 ?? []) {
  const k = `${l.event_type}/${l.status}`;
  m[k] = (m[k] ?? 0) + 1;
}
console.log(JSON.stringify(m, null, 2));
