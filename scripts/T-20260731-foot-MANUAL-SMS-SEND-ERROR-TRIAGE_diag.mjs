/**
 * T-20260731-foot-MANUAL-SMS-SEND-ERROR-TRIAGE — READ-ONLY 지문 진단 (Management API, SELECT only)
 * 원인 3분기: ① caller-clinic 게이트 오탐 ② SOLAPI 발신번호/잔액 ③ EF 404
 * prod(rxlomoozakkjesdqjtvd). NO WRITE.
 */
import fs from 'fs';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
const p = (label, rows) => { console.log(`\n─── ${label} ───`); console.log(JSON.stringify(rows, null, 2)); };

// 1) 지점별 messaging capability 상태 (후보 ②)
p('1. clinic_messaging_capability (후보②: 발신번호/활성/검증)', await q(`
  SELECT c.slug, c.name, cap.clinic_id, cap.enabled,
         cap.sender_number,
         (cap.solapi_api_key_vault_name IS NOT NULL) AS has_apikey_vault,
         (cap.solapi_secret_vault_name IS NOT NULL) AS has_secret_vault,
         cap.solapi_validation_status
  FROM clinic_messaging_capability cap
  JOIN clinics c ON c.id = cap.clinic_id
  ORDER BY c.slug;`));

// 2) 최근 manual_send 발송 이력 (실패 사유 = 후보 확정 지문)
p('2. 최근 manual_send notification_logs (실패 지문)', await q(`
  SELECT created_at, clinic_id, status, channel, recipient_phone,
         LEFT(error_message, 200) AS error_message
  FROM notification_logs
  WHERE event_type = 'manual_send'
  ORDER BY created_at DESC
  LIMIT 25;`));

// 3) 최근 실패 사유 집계
p('3. manual_send status 분포 (최근 14일)', await q(`
  SELECT status, COUNT(*) AS n, MAX(created_at) AS last_at
  FROM notification_logs
  WHERE event_type = 'manual_send' AND created_at > now() - interval '14 days'
  GROUP BY status ORDER BY n DESC;`));

// 4) staff clinic 정합 — user_profiles.clinic_id NULL/불일치 스캔 (후보①)
p('4. user_profiles clinic_id 정합 (후보①: NULL이면서 HQ role 아닌 스태프)', await q(`
  SELECT up.role,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE up.clinic_id IS NULL) AS clinic_null,
         COUNT(*) FILTER (WHERE up.clinic_id IS NOT NULL) AS clinic_set
  FROM user_profiles up
  GROUP BY up.role ORDER BY clinic_null DESC, total DESC;`));

// 5) clinic_id NULL 인데 HQ role 아닌 계정 = 게이트 403 위험군 (후보① 핵심)
p('5. ★게이트 위험군: clinic_id NULL & role NOT IN (admin,manager,director)', await q(`
  SELECT up.id, up.role, up.clinic_id,
         EXISTS(SELECT 1 FROM staff s WHERE s.user_id = up.id AND s.clinic_id IS NOT NULL) AS has_staff_clinic
  FROM user_profiles up
  WHERE up.clinic_id IS NULL
    AND (up.role IS NULL OR up.role NOT IN ('admin','manager','director'))
  ORDER BY up.role
  LIMIT 50;`));

// 6) clinics 목록 (clinic_id 참조)
p('6. clinics', await q(`SELECT id, slug, name FROM clinics ORDER BY slug;`));

console.log('\n✅ READ-ONLY 진단 완료 (write 0건)');
