/**
 * T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE — calc_copayment v1.3
 *   [이슈1] hira_unit_value 89.4 fallback 제거 + NULL→data_incomplete BLOCK.
 *   [이슈2] 65세 정률제 4구간(§2-2-3). NULLFIX v1.2 default-deny 흡수(subsume).
 * ⚠ prod 미배포 NULLFIX 를 subsume — prod v1.1 → v1.3 단일 DROP+CREATE (이중패치 0).
 * 게이트: DA GO(조건부) + CRM-PREGATE 총괄 선승인. supervisor DDL-diff 별도.
 * 사용: node scripts/apply_20260714120000_calc_copayment_hira_governed_elderly_tiers.mjs            # 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_20260714120000_calc_copayment_hira_governed_elderly_tiers.mjs   # BEGIN..ROLLBACK 검증
 * ★순서: 20260714110000 seed 먼저 적용 후 본 스크립트.
 * rollback: supabase/migrations/20260714120000_calc_copayment_hira_governed_elderly_tiers.rollback.sql (→ NULLFIX v1.2)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(__dir, '../supabase/migrations/20260714120000_calc_copayment_hira_governed_elderly_tiers.sql'), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
// RPC 마이그는 명시 txn 없음 → 원자성/무영속 위해 BEGIN..(COMMIT|ROLLBACK) 래핑
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

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} calc_copayment v1.3`);
const r = await q(SQL);
console.log('Status:', r.status, JSON.stringify(r.body));
if (!r.ok) process.exit(1);

// 사후 확인: 반환형에 data_incomplete 존재 (v1.2+ subsume 확인)
const ret = await q(`SELECT pg_get_function_result(oid) AS ret FROM pg_proc WHERE proname='calc_copayment'`);
console.log('function result type:', JSON.stringify(ret.body));
