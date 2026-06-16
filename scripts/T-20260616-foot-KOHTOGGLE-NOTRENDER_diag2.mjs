/**
 * T-20260616-foot-KOHTOGGLE-NOTRENDER  진단2 (READ-ONLY)
 * 핵심: toggle 은 latestCheckIn(=customer 의 가장 최근 non-cancelled 내원)에
 *       KOH service 있을 때만 노출. KOH 검사 내원이 '최근 내원'이 아니면 미노출.
 * 검증: KOH service 보유 customer 별로
 *   - KOH 가 들어있는 check_in 의 날짜
 *   - 그 customer 의 가장 최근 non-cancelled check_in 날짜
 *   - 둘이 같은가? (같아야 toggle 렌더)
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
const log = (...a) => console.log(...a);
log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

const q = await client.query(`
  WITH koh_ci AS (
    SELECT DISTINCT ci.id AS koh_check_in, ci.customer_id, ci.checked_in_at AS koh_at, ci.status AS koh_status
    FROM check_ins ci
    JOIN check_in_services cis ON cis.check_in_id = ci.id
    WHERE cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%'
  ),
  latest AS (
    SELECT DISTINCT ON (customer_id) customer_id, id AS latest_check_in, checked_in_at AS latest_at
    FROM check_ins
    WHERE status <> 'cancelled'
    ORDER BY customer_id, checked_in_at DESC
  )
  SELECT k.customer_id, k.koh_check_in, k.koh_at::date AS koh_d, k.koh_status,
         l.latest_check_in, l.latest_at::date AS latest_d,
         (k.koh_check_in = l.latest_check_in) AS toggle_visible
  FROM koh_ci k
  LEFT JOIN latest l ON l.customer_id = k.customer_id
  ORDER BY k.koh_at DESC
`);

let visible = 0, hidden = 0, hiddenCancelled = 0;
log(`KOH service 보유 내원 ${q.rowCount}건 — toggle 노출 여부:\n`);
for (const r of q.rows) {
  const mark = r.toggle_visible ? '✅노출' : '❌미노출';
  if (r.toggle_visible) visible++;
  else { hidden++; if (r.koh_status === 'cancelled') hiddenCancelled++; }
  log(`   ${mark}  cust=${r.customer_id?.slice(0,8)}  KOH내원=${r.koh_d}(${r.koh_status})  최근내원=${r.latest_d}`);
}
log('');
log(`── 집계 ──`);
log(`   ✅ toggle 노출(KOH=최근내원): ${visible}건`);
log(`   ❌ toggle 미노출(최근내원에 KOH 없음): ${hidden}건  (그중 KOH내원이 cancelled: ${hiddenCancelled}건)`);
log('');
await client.end();
log('✅ 진단2 완료');
