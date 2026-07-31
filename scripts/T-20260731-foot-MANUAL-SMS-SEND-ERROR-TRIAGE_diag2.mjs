/**
 * T-20260731-foot-MANUAL-SMS-SEND-ERROR-TRIAGE — DIAG2 (READ-ONLY)
 * 후보① 위험군 coordinator(68c50c25) 정체·소속 지점 단서 확정.
 * auth 조회는 id 기준(cross_crm_auth_identity_standard: email 단독신뢰 금지).
 */
import fs from 'fs';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
const p = (l, r) => { console.log(`\n─── ${l} ───`); console.log(JSON.stringify(r, null, 2)); };
const UID = '68c50c25-8725-4e96-8a52-c47dde03a786';

// A) coordinator user_profiles 전체 + auth email (id 기준 join)
p('A. 위험군 coordinator profile + auth(id기준)', await q(`
  SELECT up.id, up.role, up.clinic_id, up.name AS profile_name, up.active,
         au.email, au.last_sign_in_at, au.created_at AS auth_created
  FROM user_profiles up
  LEFT JOIN auth.users au ON au.id = up.id
  WHERE up.id = '${UID}';`));

// B) 동일 계정 staff 레코드 (소속 단서)
p('B. staff 레코드(소속 단서)', await q(`
  SELECT id, user_id, clinic_id, name, role, active
  FROM staff WHERE user_id = '${UID}';`));

// C) 이 계정이 만든 최근 활동의 clinic 분포 (실사용 지점 추정)
p('C. 활동 흔적 clinic 분포 (reservations.created_by 최근 90일)', await q(`
  SELECT clinic_id, COUNT(*) n, MAX(created_at) last_at
  FROM reservations
  WHERE created_by = '${UID}' AND created_at > now() - interval '90 days'
  GROUP BY clinic_id ORDER BY n DESC;`));

// D) notification_logs 최근 90일 caller 불명 → EF는 caller 미기록. 대신 manual_send 성공/실패 최근 60일 전체 clinic별
p('D. manual_send 최근 60일 clinic·status 매트릭스', await q(`
  SELECT clinic_id, status, COUNT(*) n, MAX(created_at) last_at
  FROM notification_logs
  WHERE event_type='manual_send' AND created_at > now() - interval '60 days'
  GROUP BY clinic_id, status ORDER BY clinic_id, n DESC;`));

console.log('\n✅ READ-ONLY DIAG2 완료 (write 0건)');
