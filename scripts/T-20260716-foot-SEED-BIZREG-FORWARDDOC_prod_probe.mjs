/**
 * T-20260716-foot-SEED-BIZREG-FORWARDDOC — evidence-based PROD probe (READ-ONLY)
 * supervisor FIX-REQUEST MSG-20260716-171533-dp4v (AUTOPROMOTE-DBCHANGE-GATE guard).
 *
 * 목적: db_change:true seed 정정(511→457)이 git merge 만으로 deployed 마킹되지 않도록,
 *       prod clinics(jongno-foot) 실재를 증거로 확증한다.
 * 기대: business_no = '457-23-00938' (prod-truth = seed 선언 정정값과 일치).
 *       seed 마이그(20260521100000)의 schema_migrations 원장 등재 여부도 함께 확인.
 * 성격: READ-ONLY (SELECT only). prod 무변경.
 * author: dev-foot / 2026-07-16
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 1) 대상 행 실재 + 기대 business_no 확증
out.clinic_row = await q(`
  SELECT slug, name, business_no, fax, phone
  FROM public.clinics
  WHERE slug = 'jongno-foot';
`);

// 2) business_no 스키마(컬럼 실재/타입)
out.column_schema = await q(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='clinics'
    AND column_name IN ('slug','business_no','fax','phone','name')
  ORDER BY column_name;
`);

// 3) seed 마이그레이션 원장 등재 여부 (이미 적용된 파일 재편집 → prod 재실행 없음 확인용)
out.ledger = await q(`
  SELECT version, name
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260521100000';
`).catch(e => ({ error: String(e) }));

// 4) 511 잔존 오염 없음 확인 (전 clinics 스캔)
out.stale_511_scan = await q(`
  SELECT count(*)::int AS stale_511
  FROM public.clinics
  WHERE business_no = '511-60-00988';
`);

const row = out.clinic_row?.[0];
const bno = row?.business_no ?? null;
const PASS = bno === '457-23-00938' && (out.stale_511_scan?.[0]?.stale_511 === 0);

console.log(JSON.stringify(out, null, 2));
console.log('\n===VERDICT===');
console.log(`clinics(jongno-foot).business_no = ${bno}`);
console.log(`expected                          = 457-23-00938`);
console.log(`stale 511 rows                    = ${out.stale_511_scan?.[0]?.stale_511}`);
console.log(`ledger 20260521100000 recorded    = ${Array.isArray(out.ledger) && out.ledger.length > 0}`);
console.log(`PROBE ${PASS ? 'PASS ✅ — prod-truth 457 확증, data-FE 정합' : 'FAIL ❌'}`);
process.exit(PASS ? 0 : 1);
