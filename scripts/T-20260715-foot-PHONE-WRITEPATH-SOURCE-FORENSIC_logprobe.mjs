/**
 * T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC — 서버 access-log 포렌식 슬라이스 (READ-ONLY, mutation 0)
 *
 * 목적: 원 포렌식 §2가 "호출자 앱 신원=레포 밖"으로 남긴 공백을 Supabase 로그 레이어에서 규명.
 *   대상: 2026-07-14 12:11:18~12:11:30 UTC (=21:11 KST) 12.1초 배치, 4건 PK
 *         a939ec01 / 2db50bad / a22437a5 / 7fe8dbdd (created_by=null).
 *   조사: 호출자 IP / User-Agent(앱) / API key role(anon vs service_role) / Referer·Origin.
 *
 * 데이터소스: Supabase Management Analytics Logs API (Logflare BigQuery warehouse).
 *   GET /v1/projects/{ref}/analytics/endpoints/logs.all?sql=..&iso_timestamp_start=..&iso_timestamp_end=..
 *   ⚠ 히스토리 조회는 iso_timestamp_start/end 필수. 창 span은 ≤24h로 클램프됨(8일 창은 빈결과).
 *   edge_logs 중첩 스키마: metadata→request→(headers, response, sb). origin 헤더 필드 없음(referer만).
 *
 * READ-ONLY: 전부 로그 SELECT. DB mutation/DDL/GRANT 0.
 * PHI off-git: IP/UA는 인프라 메타(비-PHI). phone/name 실값 미조회.
 * author: dev-foot / 2026-07-18 · 재사용: probe.mjs Management API 커넥션 패턴
 * 결과: evidence/.../dev-foot_accesslog_forensic_RESULT_20260718.md
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  for (const p of ['/Users/domas/GitHub/obliv-foot-crm/.env.local', '.env.local']) {
    try { TOKEN=(readFileSync(p,'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); if(TOKEN)break; } catch {}
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function logq(sql, s, e) {
  const u = new URL(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all`);
  u.searchParams.set('sql', sql);
  if (s) u.searchParams.set('iso_timestamp_start', s);
  if (e) u.searchParams.set('iso_timestamp_end', e);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { throw new Error(`parse: ${t.slice(0,300)}`); }
  if (j.error) throw new Error(`logflare: ${j.error}`);
  return j.result ?? [];
}
const iso = us => new Date(Number(us)/1000).toISOString();
const BW_S='2026-07-14T12:10:00.000Z', BW_E='2026-07-14T12:13:00.000Z';   // batch window ±
const TW_S='2026-07-14T12:11:10.000Z', TW_E='2026-07-14T12:11:35.000Z';   // tight around 4 rows

async function main() {
  console.log('=== ACCESS-LOG FORENSIC: 07-14 12:11 batch 호출자 신원 (READ-ONLY) ===\n');

  // STEP 0 — 로그 보존 확인 (rotate-out=부재 vs 무매칭 구분). 창 span≤24h.
  console.log('── STEP 0: edge_logs 07-14 보존 커버리지 ──');
  const day14 = await logq(`select count(*) as n from edge_logs`, '2026-07-14T00:00:00Z','2026-07-14T23:59:59Z');
  const win   = await logq(`select count(*) as n from edge_logs`, BW_S, BW_E);
  console.log(`   07-14 전일 edge_logs = ${day14[0]?.n} 행  → 보존 ${Number(day14[0]?.n)>0?'✅ 유지(rotate-out 아님)':'❌ 부재'}`);
  console.log(`   배치창(12:10~12:13) = ${win[0]?.n} 행`);

  // STEP 1 — 배치창 method/path/status 분포
  console.log('\n── STEP 1: 배치창 요청 분포 ──');
  const dist = await logq(`
    select request.method as method, request.path as path, response.status_code as status, count(*) as n
    from edge_logs
    cross join unnest(metadata) as m cross join unnest(m.request) as request cross join unnest(m.response) as response
    group by method, path, status order by n desc limit 40`, BW_S, BW_E);
  dist.forEach(r=>console.log(`   ${r.method} ${r.path} → ${r.status}  n=${r.n}`));

  // STEP 2 — 4-row POST /rest/v1/customers 호출자 신원 (핵심)
  console.log('\n── STEP 2: POST /rest/v1/customers 호출자 신원 (헤더) ──');
  const hdr = await logq(`
    select timestamp, response.status_code as status,
      h.cf_connecting_ip as cf_ip, h.x_real_ip as x_real_ip,
      h.user_agent as ua, h.x_client_info as ci, h.referer as referer, h.cf_ipcountry as country
    from edge_logs
    cross join unnest(metadata) as m cross join unnest(m.request) as request
    cross join unnest(m.response) as response cross join unnest(request.headers) as h
    where request.method='POST' and request.path='/rest/v1/customers'
    order by timestamp asc limit 30`, TW_S, TW_E);
  hdr.forEach(r=>console.log(`   ${iso(r.timestamp)} →${r.status} ip=${r.cf_ip}(${r.country}) ua=${r.ua} client=${r.ci} ref=${r.referer||'-'}`));

  // STEP 3 — auth role (anon vs service_role)
  console.log('\n── STEP 3: 인증 role (anon vs service_role) ──');
  const auth = await logq(`
    select timestamp, sb.jwt as jwt
    from edge_logs
    cross join unnest(metadata) as m cross join unnest(m.request) as request cross join unnest(request.sb) as sb
    where request.method='POST' and request.path='/rest/v1/customers'
    order by timestamp asc limit 10`, TW_S, TW_E);
  const roles = new Set();
  auth.forEach(r=>{ try{ roles.add(r.jwt?.[0]?.authorization?.[0]?.payload?.[0]?.role); }catch{} });
  console.log(`   role(s): ${[...roles].filter(Boolean).join(', ')||'(파싱실패)'}  (rows=${auth.length})`);

  // STEP 4 — churn(=simulation teardown) 확인: 같은 배치 DELETE 존재?
  console.log('\n── STEP 4: create+delete churn (simulation teardown 지문) ──');
  const churn = await logq(`
    select request.method as method, count(*) as n
    from edge_logs
    cross join unnest(metadata) as m cross join unnest(m.request) as request
    where request.path in ('/rest/v1/customers','/rest/v1/payments','/rest/v1/packages','/rest/v1/check_ins')
    group by method order by n desc`, BW_S, BW_E);
  churn.forEach(r=>console.log(`   ${r.method} n=${r.n}`));
  console.log('   → POST+DELETE 동시 = full-journey seed→teardown = E2E/simulation 하네스');

  console.log('\n=== END (mutation 0: 전부 로그 SELECT) ===');
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
