/**
 * T-20260608-foot-RESV-AUTO-SMS-NOFIRE — Solapi 전달 리포트 절단 (READ-ONLY)
 * 목표: accepted(200) ≠ delivered 확인. msgId별 최종 statusCode/statusMessage.
 *   - test_send 는 배달됐는데 manual/auto 가 미배달이면 → 수신번호 E.164 포맷 (toDomesticKR 미배포)
 *   - 전부 미배달이면 → 발신번호 미등록/3058 전송경로없음 (sender whitelist)
 * Solapi 키는 Vault RPC(get_vault_secret)로 EF와 동일 경로 조회. 절대 write 없음.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const apiKey = (await sb.rpc('get_vault_secret', { p_name: 'solapi_api_key_74967aea' })).data;
const apiSecret = (await sb.rpc('get_vault_secret', { p_name: 'solapi_secret_74967aea' })).data;
if (!apiKey || !apiSecret) { console.error('vault secret 조회 실패', { apiKey: !!apiKey, apiSecret: !!apiSecret }); process.exit(1); }
console.log('vault 키 조회 OK (apiKey prefix:', String(apiKey).slice(0, 6), ')');

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}`;
}

// 최근 발송 메시지 리스트 (오늘) — Solapi message list API
const params = new URLSearchParams({
  limit: '60',
  startDate: '2026-06-08T00:00:00Z',
});
const res = await fetch(`https://api.solapi.com/messages/v4/list?${params}`, {
  headers: { Authorization: authHeader() },
});
const data = await res.json();
console.log('Solapi list status:', res.status);
if (!res.ok) { console.error('list err:', JSON.stringify(data)); process.exit(1); }

const msgs = Object.values(data.messageList ?? {});
console.log(`총 ${msgs.length}건\n`);

// statusCode 분포
const codeDist = {};
for (const m of msgs) {
  const k = `${m.statusCode}/${m.status}`;
  codeDist[k] = (codeDist[k] ?? 0) + 1;
}
console.log('=== statusCode 분포 ===');
console.log(JSON.stringify(codeDist, null, 2));

console.log('\n=== 상세 (to / from / statusCode / statusMessage / dateReceived) ===');
for (const m of msgs.slice(0, 60)) {
  console.log(`  to=${(m.to ?? '').padEnd(13)} from=${(m.from ?? '').padEnd(12)} code=${(m.statusCode ?? '').padEnd(5)} status=${(m.status ?? '').padEnd(10)} msg="${m.statusMessage ?? ''}" reason="${m.reason ?? ''}" date=${m.dateReceived ?? m.dateCreated ?? ''}`);
}
