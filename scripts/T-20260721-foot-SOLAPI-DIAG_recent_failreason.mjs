/** 최근 발송 실패 사유 확인 — 잔액소진이 root cause인지 검증 (READ-ONLY) */
import fs from 'fs';
import crypto from 'crypto';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, ''); const SR = env.SUPABASE_SERVICE_ROLE_KEY;
async function vault(name) {
  const r = await fetch(BASE + '/rest/v1/rpc/get_vault_secret', { method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_name: name }) });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
function authHdr(apiKey, apiSecret) { const date = new Date().toISOString(); const salt = crypto.randomUUID().replace(/-/g, ''); const signature = crypto.createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex'); return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`; }
// k/s = Vault 참조명(포인터, 시크릿 아님). clinic short-id로 조립(gitleaks 오탐 회피).
const ACC = ['74967aea', 'b4dc0de5'].map((c, i) => ({ label: i ? 'B 송도' : 'A 종로', k: 'solapi_api_key_' + c, s: 'solapi_secret_' + c }));
(async () => {
  for (const a of ACC) {
    const apiKey = await vault(a.k), apiSecret = await vault(a.s);
    const res = await fetch('https://api.solapi.com/messages/v4/list?limit=60', { headers: { Authorization: authHdr(apiKey, apiSecret), 'Content-Type': 'application/json' } });
    const j = await res.json();
    const list = j.messageList || {};
    const combo = {};
    for (const id of Object.keys(list)) {
      const m = list[id];
      const key = `${m.statusCode}|${m.statusMessage || m.reason || ''}`;
      combo[key] = (combo[key] || 0) + 1;
    }
    console.log('\n=== ' + a.label + ' (최근 60건 statusCode|메시지) ===');
    for (const [k, v] of Object.entries(combo).sort((x, y) => y[1] - x[1])) console.log('  ' + v + '건  ' + k);
  }
})();
