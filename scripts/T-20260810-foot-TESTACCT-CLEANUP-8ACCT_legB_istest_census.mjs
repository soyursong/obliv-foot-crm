/**
 * T-20260810-foot-TESTACCT-CLEANUP-8ACCT — Leg B is_test census (READ-ONLY)
 *
 * 목적 (DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY, H3/H4/H6):
 *   1) flip 대상 3계정(서류테스트 F-4990 · 총괄테스트중 F-4574 · 서류테스트2 F-5113)
 *      chart_number → id 해소 + 실재/유일성(NFC exact 이름) 재확인.
 *   2) is_test 컬럼 실재 여부 확인(적용 前 기대: 부재).
 *   3) is_simulation 현값 + payments/service_charges 접점(집계 제외 정당성 근거).
 *   4) F-4427(HOLD, 이번 flip 제외) 참고 확인.
 *
 * ⛔ READ-ONLY. write/DDL 키워드 감지 시 REFUSE. flag UPDATE 는 supervisor GO-token 후 apply.
 * 실행: SUPABASE_ACCESS_TOKEN=… node scripts/T-...legB_istest_census.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd'; // foot prod

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i;
async function q(sql) {
  if (FORBIDDEN.test(sql)) throw new Error(`REFUSE write/DDL: ${sql.slice(0, 80)}`);
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const TARGETS = [
  { chart: 'F-4990', name: '서류테스트' },
  { chart: 'F-4574', name: '총괄테스트중' },
  { chart: 'F-5113', name: '서류테스트2' },
];
const HOLD = { chart: 'F-4427', name: '풋테스트1' }; // 이번 flip 제외(총괄 confirm 대기)

const out = [];
const log = (s) => { out.push(s); console.log(s); };

log('# Leg B is_test census — ' + new Date().toISOString());
log('foot prod ' + REF + ' / READ-ONLY\n');

// ─── 1) is_test 컬럼 실재 확인 (적용 前 기대: 0행) ───
const col = await q(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name='customers' AND column_name='is_test';`);
log('## 1) customers.is_test 컬럼 실재');
log('```json\n' + JSON.stringify(col, null, 2) + '\n```');
log('(적용 前 기대: 0행 = 컬럼 부재)\n');

// ─── 2) 3계정 + HOLD chart_number → id 해소 + NFC exact ───
const charts = [...TARGETS, HOLD].map((t) => `'${t.chart}'`).join(',');
// PHI 준수(§4.3): phone/RRN 미조회. chart_number+id+name(테스트라벨)+NFC+is_simulation 만.
const rows = await q(`SELECT id::text, chart_number, name,
    normalize(name,NFC)=name AS is_nfc, is_simulation, created_at
  FROM customers WHERE chart_number IN (${charts}) ORDER BY chart_number;`);
log('## 2) chart_number → id 해소 + NFC-exact + is_simulation');
log('```json\n' + JSON.stringify(rows.map(r=>({...r,id:r.id})), null, 2) + '\n```');

// 유일성 검증
const dup = await q(`SELECT chart_number, count(*) n FROM customers
  WHERE chart_number IN (${charts}) GROUP BY chart_number HAVING count(*)>1;`);
log('유일성 위반(기대 0행): ' + JSON.stringify(dup) + '\n');

// ─── 3) NFC-exact 대조 (기대 name 문자열 정합) ───
log('## 3) 이름 NFC-exact 대조');
for (const t of [...TARGETS, HOLD]) {
  const r = rows.find((x) => x.chart_number === t.chart);
  if (!r) { log(`- ${t.chart} (${t.name}): ❌ NOT FOUND`); continue; }
  const nameMatch = r.name === t.name;
  log(`- ${t.chart}: db='${r.name}' 기대='${t.name}' 일치=${nameMatch} NFC=${r.is_nfc} id=${r.id}`);
}
log('');

// ─── 4) payments/service_charges 접점 (집계 제외 정당성) ───
const ids = rows.map((r) => `'${r.id}'::uuid`).join(',');
log('## 4) 재무 접점 (payments/service_charges/package_payments)');
for (const tbl of ['payments', 'service_charges', 'package_payments', 'package_credit_ledger']) {
  try {
    const c = await q(`SELECT customer_id::text cid, count(*) n,
      COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net
      FROM ${tbl} WHERE customer_id IN (${ids}) GROUP BY customer_id;`).catch(async () => {
      // service_charges may not have payment_type/amount shape — fallback count only
      return await q(`SELECT customer_id::text cid, count(*) n FROM ${tbl} WHERE customer_id IN (${ids}) GROUP BY customer_id;`);
    });
    log(`- ${tbl}: ` + JSON.stringify(c));
  } catch (e) {
    log(`- ${tbl}: (skip) ${String(e.message).slice(0, 80)}`);
  }
}

fs.writeFileSync('scripts/T-20260810-foot-TESTACCT-CLEANUP-8ACCT_legB_istest_census.out.md', out.join('\n'));
log('\n✅ census 완료 → scripts/..._legB_istest_census.out.md');
