/**
 * T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM — calc_copayment v1.4
 *   노인 외래 정률구간(10/20/30%) 원단위 CEIL(100원 올림) → FLOOR(100원 미만 절사).
 *   규정: 국민건강보험법 시행령 별표2 §19① "100원 미만은 제외" + 심평원 외래 본인부담기준표.
 * 게이트: supervisor 게이트 + pg_proc PREFLIGHT(deploy-precheck C10). 배포=supervisor exec lane.
 * 사용: node scripts/apply_20260714133000_calc_copayment_elderly_floor_rounding.mjs           # 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_20260714133000_calc_copayment_elderly_floor_rounding.mjs  # BEGIN..ROLLBACK 무영속 검증
 * base = v1.3(20260714120500). rollback: ...rollback.sql (→ v1.3 CEIL 복원)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(__dir, '../supabase/migrations/20260714133000_calc_copayment_elderly_floor_rounding.sql'), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
// RPC 마이그는 명시 txn 없음(내장 COMMIT 0 확인) → BEGIN..(COMMIT|ROLLBACK) 래핑 안전.
const SQL = `BEGIN;\n${RAW}\n${DRYRUN ? 'ROLLBACK;' : 'COMMIT;'}\n`;

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  return { ok: resp.ok, status: resp.status, body: await resp.json() };
}

// PRE-probe: 노인 정률구간 CEIL/FLOOR 현행 확인
const pre = await q(`SELECT pg_get_functiondef(oid) ILIKE '%FLOOR((v_base * 0.10)%' AS has_floor,
                            pg_get_functiondef(oid) ILIKE '%CEIL((v_base * 0.10)%' AS has_ceil
                     FROM pg_proc WHERE proname='calc_copayment'`);
console.log('PRE-probe (elderly 10% bracket):', JSON.stringify(pre.body));

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} calc_copayment v1.4 (elderly FLOOR)`);
const r = await q(SQL);
console.log('Status:', r.status, JSON.stringify(r.body));
if (!r.ok) process.exit(1);

// POST-probe: DRYRUN 이면 무영속(여전히 CEIL), APPLY 면 FLOOR
const post = await q(`SELECT pg_get_functiondef(oid) ILIKE '%FLOOR((v_base * 0.10)%' AS has_floor,
                             pg_get_functiondef(oid) ILIKE '%CEIL((v_base * 0.10)%' AS has_ceil_elderly
                      FROM pg_proc WHERE proname='calc_copayment'`);
console.log(`POST-probe (${DRYRUN ? 'expect UNCHANGED=CEIL' : 'expect FLOOR'}):`, JSON.stringify(post.body));
