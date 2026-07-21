/**
 * T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — 재오염 sentinel + 잔여 주기 sweep (READ-ONLY)
 *
 * DA CONSULT-REPLY(xfat) §0-2-a-3 / §3: AC-2 ingest 가드 배포 전까지 신규 NFD 유입은 residual.
 *   동일 NFD 지문(char_length(v)<>char_length(normalize(v,NFC)))을 일일 정합성 감사에 fold.
 *   surface 별 NFD count 계수 → >0 이면 재-sweep 트리거(informational; 멱등 self-heal 대상). silent cap 금지.
 *
 * 종료코드: NFD>0 이면 1 (감사 알림 훅), 0 이면 0.
 * 실행: SUPABASE_ACCESS_TOKEN=… node scripts/..._nfd_sentinel_sweep.mjs
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function q(sql, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    const t = await r.text();
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
    return JSON.parse(t);
  }
  throw new Error('429');
}
// 정정된 3 customer_id (sentinel 재진입 감시 대상)
const SEEDS = ['b734f069-5a06-414b-9ad6-f32ee3b3bf2c','f137fe98-30b2-4a66-bcc0-73bc68277b58','0fc0752c-7ccd-4a71-85ec-b7e4e5f20527'];
try {
  const census = await q(`
    SELECT 'customers.name' surface, count(*)::int n FROM public.customers WHERE name IS NOT NULL AND char_length(name)<>char_length(normalize(name,NFC))
    UNION ALL SELECT 'reservations.customer_name', count(*)::int FROM public.reservations WHERE customer_name IS NOT NULL AND char_length(customer_name)<>char_length(normalize(customer_name,NFC))
    UNION ALL SELECT 'check_ins.customer_name', count(*)::int FROM public.check_ins WHERE customer_name IS NOT NULL AND char_length(customer_name)<>char_length(normalize(customer_name,NFC))
    UNION ALL SELECT 'notification_logs.body_rendered(제외/모니터)', count(*)::int FROM public.notification_logs WHERE body_rendered IS NOT NULL AND char_length(body_rendered)<>char_length(normalize(body_rendered,NFC))
    ORDER BY 1;`);
  const sentinel = await q(`
    SELECT count(*)::int n FROM public.customers
    WHERE id IN ('${SEEDS.join("','")}') AND char_length(name)<>char_length(normalize(name,NFC));`);
  console.log(`[NFD-SWEEP ${REF}] surface census:`);
  let live = 0;
  for (const r of census) { console.log(`  ${r.surface}: ${r.n}`); if (!/제외/.test(r.surface)) live += Number(r.n); }
  const reentry = Number(sentinel[0].n);
  console.log(`  [sentinel] 정정 3 seed NFD 재진입: ${reentry} ${reentry>0?'🔴 재오염!':'✅'}`);
  console.log(`  → 정정대상 surface NFD 합계(제외 surface 제외): ${live}`);
  if (live > 0 || reentry > 0) { console.log('  ⚠ NFD>0 — 재-sweep 트리거 대상(멱등 self-heal). silent cap 금지.'); process.exit(1); }
  console.log('  ✅ NFD 0 — clean.');
} catch (e) { console.error('❌ sweep 실패:', e.message); process.exit(2); }
