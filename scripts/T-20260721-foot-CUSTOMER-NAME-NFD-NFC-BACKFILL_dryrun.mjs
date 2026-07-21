/**
 * T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — DRY-RUN (No-Persistence Protocol)
 *
 * 1) DO 블록(UPDATE + 계측 + RAISE EXCEPTION) 실행 → 강제 unwind, persist 0.
 *    read_only:false 필요(UPDATE) 이나 COMMIT 없음 + 예외 unwind → prod 무변화.
 * 2) 별도 read-only post-probe: NFD 원상(cust3/aicc3) 재확인 = 무영속 증명.
 *
 * ⛔ 이 스크립트는 dry-run evidence 생성 전용 — 실제 APPLY 아님(persist 0). supervisor 승인 후 apply 는 별도.
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
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function q(sql, readOnly, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    });
    const text = await r.text();
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    return { ok: r.ok, status: r.status, text };
  }
  throw new Error('429 재시도 소진');
}
const NFDPROBE = `
  SELECT 'customers' t, count(*)::int n FROM public.customers WHERE name IS NOT NULL AND char_length(name)<>char_length(normalize(name,NFC))
  UNION ALL SELECT 'reservations', count(*)::int FROM public.reservations WHERE customer_name IS NOT NULL AND char_length(customer_name)<>char_length(normalize(customer_name,NFC))
  UNION ALL SELECT 'check_ins', count(*)::int FROM public.check_ins WHERE customer_name IS NOT NULL AND char_length(customer_name)<>char_length(normalize(customer_name,NFC))
  UNION ALL SELECT 'aicc', count(*)::int FROM public.aicc_crm_phone_match WHERE name IS NOT NULL AND char_length(name)<>char_length(normalize(name,NFC))
  ORDER BY 1;`;

try {
  console.log('═══ DRY-RUN (No-Persistence) — foot prod rxlomoozakkjesdqjtvd ═══\n');

  console.log('━━ PRE-PROBE (read-only): 백필 전 NFD census ━━');
  let pre = await q(NFDPROBE, true);
  if (!pre.ok) throw new Error(`pre-probe: HTTP ${pre.status}: ${pre.text}`);
  console.log('  ', pre.text);

  console.log('\n━━ DRY-RUN DO 블록 (read_only:false, RAISE EXCEPTION unwind → persist 0) ━━');
  const dry = fs.readFileSync('supabase/migrations/20260721140000_customers_name_nfd_nfc_backfill.dryrun.sql', 'utf8');
  const res = await q(dry, false);
  // 기대: RAISE EXCEPTION 으로 실패(ok=false) + 메시지에 계측치 포함.
  console.log(`  HTTP ${res.status} ok=${res.ok}`);
  console.log('  →', res.text);
  const expectedRollback = /DRYRUN\(no-persist\)/.test(res.text);
  console.log(`  no-persistence sentinel(RAISE EXCEPTION) 감지: ${expectedRollback ? '✅ YES (unwind 확정)' : '⚠ NO — 확인필요'}`);

  console.log('\n━━ POST-PROBE (read-only): 무영속 재확인 (PRE 와 동일해야 함) ━━');
  await sleep(1500);
  let post = await q(NFDPROBE, true);
  if (!post.ok) throw new Error(`post-probe: HTTP ${post.status}: ${post.text}`);
  console.log('  ', post.text);
  const same = pre.text === post.text;
  console.log(`\n${same ? '✅' : '❌'} 무영속 판정: PRE ${same ? '==' : '<>'} POST — ${same ? 'persist 0 확정(dry-run 안전)' : 'DRIFT! 조사 필요'}`);
} catch (e) {
  console.error('❌ DRY-RUN 실패:', e.message);
  process.exit(1);
}
