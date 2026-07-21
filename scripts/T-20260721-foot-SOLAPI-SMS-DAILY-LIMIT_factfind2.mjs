/** factfind2 — 두 계정 각각 식별 + 일일 한도/통계 (READ-ONLY) */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const kst0 = '2026-07-20T15:00:00Z'; // 2026-07-21 KST 자정

async function probe(vaultKey, vaultSecret, label) {
  const apiKey = (await sb.rpc('get_vault_secret', { p_name: vaultKey })).data;
  const apiSecret = (await sb.rpc('get_vault_secret', { p_name: vaultSecret })).data;
  if (!apiKey || !apiSecret) { console.log(`\n### ${label}: vault 조회 실패`); return; }
  const auth = () => {
    const date = new Date().toISOString(); const salt = crypto.randomBytes(16).toString('hex');
    const sig = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
    return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}`;
  };
  const get = async (p) => { try { const r = await fetch(`https://api.solapi.com${p}`, { headers: { Authorization: auth() } }); return { s: r.status, b: await r.json().catch(()=>({})) }; } catch(e){ return { s:0, b:{e:String(e)} }; } };

  console.log(`\n################ ${label}  vault=${vaultKey} apiKey=${String(apiKey).slice(0,8)}… ################`);
  const me = await get('/users/v1/member');
  console.log('  member:', me.s, `email=${me.b.email} name=${me.b.name} accountId=${me.b.selectedAccountId ?? me.b.accountId} isTrial=${me.b.isTrial}`);
  const bal = await get('/cash/v1/balance');
  console.log('  balance:', bal.s, `balance=${bal.b.balance} deposit=${bal.b.deposit} point=${bal.b.point}`);
  // 발신번호 목록
  const snd = await get('/senderid/v1/numbers');
  const nums = Array.isArray(snd.b) ? snd.b : (snd.b.senderIdList ? Object.values(snd.b.senderIdList) : []);
  console.log('  senderids:', snd.s, JSON.stringify(nums.map(n => ({ num: n.phoneNumber, status: n.status })) ).slice(0,300));
  // 금일 발송 통계
  const stat = await get(`/messages/v4/statistics?startDate=${kst0}`);
  console.log('  statistics:', stat.s, JSON.stringify(stat.b).slice(0,500));
  // 금일 메시지 카운트(페이지네이션)
  let total = 0; const dist = {};
  for (let i=0;i<12;i++){ const r = await get(`/messages/v4/list?${new URLSearchParams({limit:'500',startDate:kst0})}`); if(r.s!==200){ console.log('  list err', r.s); break;} const ms=Object.values(r.b.messageList??{}); total+=ms.length; for(const m of ms){const k=`${m.statusCode}/${m.status}`;dist[k]=(dist[k]??0)+1;} if(ms.length<500)break; }
  console.log(`  금일 메시지 총 ${total}건`, JSON.stringify(dist));
}

// 두 계정
await probe('solapi_api_key_74967aea', 'solapi_secret_74967aea', 'clinic 74967aea (sender 0108827****)');
await probe('solapi_api_key_b4dc0de5', 'solapi_secret_b4dc0de5', 'clinic b4dc0de5 (sender 0103457****)');

console.log('\n[factfind2 DONE]');
