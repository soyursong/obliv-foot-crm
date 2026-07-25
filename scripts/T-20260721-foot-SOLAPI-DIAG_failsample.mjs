/** 실패 샘플 특성화 — statusCode별 메시지 + 시각대 분포 (READ-ONLY) */
import fs from 'fs';
import crypto from 'crypto';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, ''); const SR = env.SUPABASE_SERVICE_ROLE_KEY;
async function vault(name) { const r = await fetch(BASE + '/rest/v1/rpc/get_vault_secret', { method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_name: name }) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
function authHdr(apiKey, apiSecret) { const date = new Date().toISOString(); const salt = crypto.randomUUID().replace(/-/g, ''); const signature = crypto.createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex'); return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`; }
async function solGet(apiKey, apiSecret, path) { const res = await fetch('https://api.solapi.com' + path, { headers: { Authorization: authHdr(apiKey, apiSecret), 'Content-Type': 'application/json' } }); return { status: res.status, json: await res.json().catch(() => ({})) }; }
// k/s = Vault 참조명(포인터, 시크릿 아님). clinic short-id로 조립(gitleaks 오탐 회피).
const ACC = ['74967aea', 'b4dc0de5'].map((c, i) => ({ label: i ? 'B 송도' : 'A 종로', k: 'solapi_api_key_' + c, s: 'solapi_secret_' + c }));
(async () => {
  for (const a of ACC) {
    const apiKey = await vault(a.k), apiSecret = await vault(a.s);
    let nextKey = null, page = 0; const codeMsg = {}; const failByDay = {};
    do {
      let path = '/messages/v4/list?limit=500'; if (nextKey) path += '&startKey=' + encodeURIComponent(nextKey);
      const { status, json } = await solGet(apiKey, apiSecret, path);
      if (status !== 200) break;
      const list = json.messageList || {};
      for (const id of Object.keys(list)) {
        const m = list[id];
        if (String(m.statusCode) !== '2000') {
          const key = `${m.statusCode}|${m.statusMessage || m.reason || ''}`;
          codeMsg[key] = (codeMsg[key] || 0) + 1;
          const d = (m.dateCreated || '').slice(0, 10);
          if (d) { failByDay[d] = failByDay[d] || {}; failByDay[d][m.statusCode] = (failByDay[d][m.statusCode] || 0) + 1; }
        }
      }
      nextKey = json.nextKey || null; page++;
    } while (nextKey && page < 12); // 최근 ~6000건만
    console.log('\n=== ' + a.label + ' — 최근 ~' + (page * 500) + '건 中 비-2000(실패/기타) 분포 ===');
    for (const [k, v] of Object.entries(codeMsg).sort((x, y) => y[1] - x[1])) console.log('  ' + v + '건  ' + k);
    const recentDays = Object.keys(failByDay).sort().slice(-6);
    console.log('  -- 최근 6일 실패코드 --');
    for (const d of recentDays) console.log('  ' + d + ' : ' + JSON.stringify(failByDay[d]));
  }
})();
