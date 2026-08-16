/**
 * T-20260817-body-SECRET-INTERNAL-CRON-REDACT-ROTATE (§3 cross-fork completeness)
 * READ-ONLY digest census — foot prod vault `internal_cron_secret` digest 대조.
 * 평문 미반출: sha256 digest 를 SQL 내부에서 계산해 hex 만 반환. prod WRITE/DDL 0.
 * ref rxlomoozakkjesdqjtvd (foot canon). Management API /database/query, SUPABASE_ACCESS_TOKEN only.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
const BODY_LEAK = '622078d4';       // body 노출 digest (8-hex prefix)
const EXPECT_NEW = '9eb7091f';      // foot rotation NEW digest prefix (T-20260810 flip evidence)
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g,'');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }
async function qj(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method:'POST', headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}
(async () => {
  // 0. ref 확인 (foot prod 확정)
  const who = await qj(`SELECT current_database() db, inet_server_addr()::text server_addr`);
  console.log('conn =', JSON.stringify(who[0]));

  // 1. vault 존재/개수 (평문 미노출 — digest hex 만)
  const rows = await qj(`
    SELECT name,
           encode(sha256(decrypted_secret::bytea),'hex') AS digest_hex,
           length(decrypted_secret) AS plaintext_len
    FROM vault.decrypted_secrets
    WHERE name = 'internal_cron_secret'`);
  console.log('icron_cnt =', rows.length);
  if (rows.length === 0) { console.error('❌ internal_cron_secret ABSENT'); process.exit(2); }

  const full = rows[0].digest_hex;
  const pref = full.slice(0,8);
  console.log('foot vault internal_cron_secret digest (sha256 full) =', full);
  console.log('foot digest prefix(8)                              =', pref);
  console.log('body-leak digest                                   =', BODY_LEAK);
  console.log('expected NEW (foot rotation)                       =', EXPECT_NEW);
  console.log('--- verdict ---');
  console.log('== body-leak(622078d4)?  =', pref === BODY_LEAK);
  console.log('== expected NEW(9eb7091f)? =', pref === EXPECT_NEW);
  const verdict = pref === BODY_LEAK ? 'MATCH-BODY-LEAK ⚠ (secret 공유 — foot rotation 후속 필요)'
                : pref === EXPECT_NEW ? 'MISMATCH (secret 미공유 · foot rotation NEW 확정 — §3 close)'
                : 'MISMATCH-UNEXPECTED (body-leak 아님 · 단 NEW prefix 불일치 — 확인 필요)';
  console.log('VERDICT =', verdict);
})().catch(e=>{ console.error('CENSUS FAIL:', e.message); process.exit(1); });
