/** count — 금일 정확 발송량 (cursor 페이지네이션) READ-ONLY */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const kst0 = '2026-07-20T15:00:00Z';

async function count(vaultKey, vaultSecret, label) {
  const apiKey = (await sb.rpc('get_vault_secret', { p_name: vaultKey })).data;
  const apiSecret = (await sb.rpc('get_vault_secret', { p_name: vaultSecret })).data;
  const auth = () => { const d=new Date().toISOString(); const s=crypto.randomBytes(16).toString('hex'); const g=crypto.createHmac('sha256',apiSecret).update(d+s).digest('hex'); return `HMAC-SHA256 apiKey=${apiKey}, date=${d}, salt=${s}, signature=${g}`; };
  let total=0; const dist={}; let startKey=null; let pages=0;
  while (pages < 60) {
    const p = new URLSearchParams({ limit:'500', startDate: kst0 });
    if (startKey) p.set('startKey', startKey);
    const r = await fetch(`https://api.solapi.com/messages/v4/list?${p}`, { headers:{Authorization:auth()} });
    if (r.status!==200){ console.log(label,'list err',r.status); break; }
    const b = await r.json();
    const ms = Object.values(b.messageList ?? {});
    total += ms.length;
    for (const m of ms){ const k=`${m.statusCode}`; dist[k]=(dist[k]??0)+1; }
    pages++;
    startKey = b.nextKey || b.startKey || null;
    if (!startKey || ms.length < 500) break;
  }
  console.log(`\n${label}: 금일(KST) Solapi 메시지 총 ${total}건 (pages=${pages}) statusCode분포=${JSON.stringify(dist)}`);
}
await count('solapi_api_key_74967aea','solapi_secret_74967aea','[A] 74967aea (문지은/performance@oblivseoul.kr, sender 0108827****)');
await count('solapi_api_key_b4dc0de5','solapi_secret_b4dc0de5','[B] b4dc0de5 (박영진/oblivclinicwd@gmail.com, sender 0103457****)');
console.log('\n[count DONE]');
