/**
 * T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — supervisor DB-GATE prod introspection (READ-ONLY, write 0)
 * Management API /database/query, SUPABASE_ACCESS_TOKEN only. ref rxlomoozakkjesdqjtvd.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
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
const j = (o) => JSON.stringify(o);
(async () => {
  // 1. kcd_code already present? (expect ABSENT → genuine ADD)
  const col = await qj(`SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' AND column_name='kcd_code'`);
  console.log('C1 check_ins.kcd_code present =', col.length>0, j(col));

  // 2. ledger: 20260615180000 (anon REVOKE) applied?  + 20260811010000 collision?
  const led = await qj(`SELECT version FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260615180000','20260811010000','20260811000000') ORDER BY version`);
  console.log('C2 ledger hits =', j(led.map(x=>x.version)));

  // 3. anon SELECT on check_ins (expect 0 / revoked)
  const grants = await qj(`SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='check_ins' AND grantee IN ('anon')`);
  console.log('C3 anon grants on check_ins =', j(grants));

  // 4. anon_checkin_read policy present? (expect dropped → 0)
  const pol = await qj(`SELECT policyname, cmd, roles::text FROM pg_policies
    WHERE schemaname='public' AND tablename='check_ins' ORDER BY policyname`);
  console.log('C4 check_ins policies count =', pol.length);
  console.log('C4 policies =', j(pol));
  const anonRead = pol.filter(p=>/anon/i.test(p.roles) || /anon/i.test(p.policyname));
  console.log('C4 anon-touching policies =', j(anonRead));

  // 5. RLS enabled on check_ins?
  const rls = await qj(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='check_ins'`);
  console.log('C5 check_ins RLS =', j(rls));

  // 6. table PHI grants overview (public/authenticated)
  const allg = await qj(`SELECT grantee, string_agg(privilege_type,',' ORDER BY privilege_type) privs
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='check_ins' GROUP BY grantee ORDER BY grantee`);
  console.log('C6 check_ins all grants =', j(allg));
})().catch(e=>{ console.error('INTROSPECT FAIL:', e.message); process.exit(1); });
