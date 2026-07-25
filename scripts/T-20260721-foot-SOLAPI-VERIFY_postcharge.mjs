/**
 * T-20260721-foot-SOLAPI — 충전 후 정상화 검증 (CEO 필수 evidence)
 * ⚠️ 충전 완료 통보를 받은 뒤에만 실행. (지금 실행 금지 — 잔액0이면 실패)
 * evidence = ① Solapi 응답코드(2000) + ② balance 차감 + ③ notification_logs sent 카운트 증가
 *
 * 실행: node scripts/T-20260721-foot-SOLAPI-VERIFY_postcharge.mjs <TEST_PHONE> [A|B|both]
 *   TEST_PHONE = 동의된 내부 테스트 수신번호 (숫자만). 인자로만 전달 — 코드에 하드코딩 금지(PHI).
 * READ 대부분 + 계정당 SMS 1건 실발송(검증 목적, 최소).
 */
import fs from 'fs';
import crypto from 'crypto';

const TEST_PHONE = (process.argv[2] || '').replace(/[^0-9]/g, '');
const WHICH = (process.argv[3] || 'both').toLowerCase();
if (!TEST_PHONE || TEST_PHONE.length < 10) {
  console.error('사용법: node scripts/T-20260721-foot-SOLAPI-VERIFY_postcharge.mjs <TEST_PHONE(숫자)> [A|B|both]');
  process.exit(1);
}

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, ''); const SR = env.SUPABASE_SERVICE_ROLE_KEY;

async function vault(name) { const r = await fetch(BASE + '/rest/v1/rpc/get_vault_secret', { method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_name: name }) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function rest(path) { const r = await fetch(BASE + '/rest/v1/' + path, { headers: { apikey: SR, Authorization: 'Bearer ' + SR, Prefer: 'count=exact' } }); return { rows: await r.json(), cnt: r.headers.get('content-range') }; }
function authHdr(k, s) { const d = new Date().toISOString(); const salt = crypto.randomUUID().replace(/-/g, ''); const sig = crypto.createHmac('sha256', s).update(d + salt).digest('hex'); return `HMAC-SHA256 apiKey=${k}, date=${d}, salt=${salt}, signature=${sig}`; }
async function solGet(k, s, path) { const r = await fetch('https://api.solapi.com' + path, { headers: { Authorization: authHdr(k, s), 'Content-Type': 'application/json' } }); return { status: r.status, json: await r.json().catch(() => ({})) }; }
async function solSend(k, s, from, to, text) {
  const body = { message: { to: to.replace(/\D/g, ''), from: from.replace(/\D/g, ''), text, type: text.length > 45 ? 'LMS' : 'SMS' } };
  const r = await fetch('https://api.solapi.com/messages/v4/send', { method: 'POST', headers: { Authorization: authHdr(k, s), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { httpStatus: r.status, json: await r.json().catch(() => ({})) };
}

// 소유자 sender 번호는 clinic_messaging_capability 에서 조회(코드 하드코딩 회피).
const ACC = [
  { key: 'A', label: 'A 종로', clinic_id: '74967aea-a60b-4da3-a0e7-9c997a930bc8', short: '74967aea' },
  { key: 'B', label: 'B 송도', clinic_id: 'b4dc0de5-f007-4a57-8888-aabbccddeeff', short: 'b4dc0de5' },
].filter((a) => WHICH === 'both' || WHICH === a.key.toLowerCase());

(async () => {
  for (const a of ACC) {
    console.log('\n=== 검증: ' + a.label + ' ===');
    const apiKey = await vault('solapi_api_key_' + a.short);
    const apiSecret = await vault('solapi_secret_' + a.short);
    const { rows: capRows } = await rest(`clinic_messaging_capability?clinic_id=eq.${a.clinic_id}&select=sender_number`);
    const sender = capRows?.[0]?.sender_number;
    if (!sender) { console.log('  sender_number 없음 — skip'); continue; }

    const balBefore = await solGet(apiKey, apiSecret, '/cash/v1/balance');
    const { cnt: sentBefore } = await rest(`notification_logs?clinic_id=eq.${a.clinic_id}&status=eq.sent&select=id`);
    console.log('  [before] balance=', balBefore.json.balance, ' notif_sent(range)=', sentBefore);

    const stamp = new Date().toISOString().slice(11, 19);
    const res = await solSend(apiKey, apiSecret, sender, TEST_PHONE, `[정상화검증] T-20260721 ${stamp} 발송 테스트`);
    const gi = res.json.groupInfo || {};
    console.log('  [send] http=', res.httpStatus, ' statusCode=', res.json.statusCode, ' groupId=', res.json.groupId || gi.groupId, ' countForCharge=', JSON.stringify(gi.count || res.json.count || {}));
    console.log('  [send raw]', JSON.stringify(res.json).slice(0, 400));

    const balAfter = await solGet(apiKey, apiSecret, '/cash/v1/balance');
    console.log('  [after] balance=', balAfter.json.balance, ' (차감=', (balBefore.json.balance - balAfter.json.balance).toFixed(2), '원)');

    const pass = res.json.statusCode === '2000' && res.httpStatus === 200;
    console.log('  ==> ' + (pass ? 'PASS(Solapi 2000 접수)' : 'FAIL — ' + JSON.stringify(res.json).slice(0, 200)));
    console.log('  ↳ notification_logs sent 증가는 실 예약트래픽/pending 재시도로 수분내 반영 — 재조회로 확인:');
    console.log(`     GET notification_logs?clinic_id=eq.${a.clinic_id}&status=eq.sent (range 증가 확인)`);
  }
})();
