/**
 * T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — REOPENED DIAG (READ-ONLY, Management API)
 * prod(rxlomoozakkjesdqjtvd) 함수 정의 introspection + 실저장값 대조. SELECT only.
 */
import fs from 'fs';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function insertBlocks(def) {
  const re = /INSERT\s+INTO\s+(?:public\.)?customers\s*\(([^)]*)\)/gis;
  let m, hits = [];
  while ((m = re.exec(def)) !== null) {
    const cols = m[1].replace(/\s+/g, ' ').trim();
    hits.push({ cols, hasCreatedBy: /\bcreated_by\b/i.test(cols) });
  }
  return hits;
}

const FNS = [
  'self_checkin_with_reservation_link',
  'fn_selfcheckin_upsert_customer',
  'fn_selfcheckin_upsert_customer_resolve_v2',
  'fn_selfcheckin_upsert_customer_resolve_v3',
  'self_checkin_create',
];

(async () => {
  console.log('═══ prod introspection @ ' + REF + ' (READ-ONLY, mgmt api) ═══\n');
  for (const fn of FNS) {
    const rows = await q(`
      SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='${fn}' ORDER BY 1;`);
    if (!rows.length) { console.log(`○ ${fn}: prod 부재(0 오버로드)\n`); continue; }
    for (const r of rows) {
      const ins = insertBlocks(r.def);
      const stamped = ins.filter(x => x.hasCreatedBy).length;
      console.log(`● ${r.sig}`);
      console.log(`   customers INSERT: ${ins.length}개 / created_by 스탬프: ${stamped}개`);
      ins.forEach((x, i) => console.log(`     [${i}] created_by=${x.hasCreatedBy ? 'YES ✓' : 'NO ✗'} :: (${x.cols.slice(0, 80)}…)`));
      console.log('');
    }
  }

  const cb = await q(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE created_by IS NOT NULL) AS not_null,
           count(*) FILTER (WHERE created_by='self_checkin') AS self_stamp
      FROM customers WHERE created_at >= now() - interval '30 days';`);
  console.log('═══ customers.created_by 실저장 (최근 30일) ═══');
  console.log(`   total=${cb[0].total}, NOT NULL=${cb[0].not_null}, ='self_checkin'=${cb[0].self_stamp}\n`);

  // check_ins.changed_by 지문(self_checkin) 대비 — 실호출 발생 증거
  const ci = await q(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE changed_by='self_checkin') AS self_ci
      FROM status_transitions WHERE created_at >= now() - interval '30 days';`);
  console.log('═══ status_transitions.changed_by (최근 30일, 실호출 증거) ═══');
  console.log(`   total=${ci[0].total}, ='self_checkin'=${ci[0].self_ci}`);
})().catch(e => { console.error(e); process.exit(1); });
