/**
 * T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG 요건(1) — resettle_insurance_grade CEIL→FLOOR 정합
 *   dev-foot prod self-apply runner (precedent 40571/42195). change-class = ADDITIVE-LOGIC
 *   (CREATE OR REPLACE 함수 body 1줄 CEIL→FLOOR, 스키마/컬럼/enum/시그니처 무변경 → §S2.4 DA gate 비대상).
 *   supervisor DB-GATE GO旣발행 + DA HOLD recheck CLEAN(soft-gate).
 *
 *   ① preflight : pg_get_functiondef 실측 → CEIL 잔존(floor=0/ceil=1) 재확인 (supervisor postcheck 정합).
 *   ② apply     : up.sql(CREATE OR REPLACE) 영속 적용 (single DDL, 자체 txn).
 *   ③ postcheck : pg_get_functiondef 재실측 → floor_count>=1 / ceil_count=0 확인.
 *
 * mode: node ...apply.mjs [preflight|apply|postcheck]  (기본 preflight)
 * prod=rxlomoozakkjesdqjtvd.
 */
import { readFileSync } from 'node:fs';
const DIR = '/Users/domas/GitHub/obliv-foot-crm';
const env = Object.fromEntries(readFileSync(`${DIR}/.env.local`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const UP = `${DIR}/supabase/migrations/20260727213000_foot_resettle_provisional_floor_align.sql`;

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

// pg_get_functiondef 내 v_prov_row 재구성 라인의 FLOOR/CEIL 계수 (대소문자 무관)
async function probe() {
  const rows = await q(`
    WITH def AS (SELECT pg_get_functiondef('public.resettle_insurance_grade(uuid,text,boolean,text)'::regprocedure) AS d)
    SELECT
      (SELECT count(*)::int FROM regexp_matches((SELECT d FROM def), 'FLOOR\\(\\(v_calc\\.base_amount \\* 0\\.30\\)', 'gi')) AS floor_count,
      (SELECT count(*)::int FROM regexp_matches((SELECT d FROM def), 'CEIL\\(\\(v_calc\\.base_amount \\* 0\\.30\\)',  'gi')) AS ceil_count`);
  return rows[0];
}

const mode = process.argv[2] || 'preflight';

if (mode === 'preflight') {
  console.log('════ ① PREFLIGHT (READ-ONLY, prod 현재 상태) ════');
  const p = await probe();
  console.log('[prod] v_prov_row FLOOR =', p.floor_count, '/ CEIL =', p.ceil_count);
  console.log(p.ceil_count === 1 && p.floor_count === 0
    ? '→ CEIL 잔존(미적용) — supervisor preflight 정합. apply 필요.'
    : `→ 예상과 다름(FLOOR=${p.floor_count}/CEIL=${p.ceil_count}). 확인 필요.`);
} else if (mode === 'apply') {
  console.log('════ ② APPLY (영속, CREATE OR REPLACE single-txn) ════');
  const pre = await probe();
  console.log('[pre] FLOOR =', pre.floor_count, '/ CEIL =', pre.ceil_count);
  await q(readFileSync(UP, 'utf8'));
  const post = await probe();
  console.log('[post] FLOOR =', post.floor_count, '/ CEIL =', post.ceil_count, '(기대 FLOOR>=1 / CEIL=0)');
  if (post.floor_count < 1 || post.ceil_count !== 0) throw new Error(`APPLY 검증 실패: ${JSON.stringify(post)}`);
  console.log('APPLY OK — CEIL→FLOOR 정합 확정.');
} else if (mode === 'postcheck') {
  console.log('════ ③ POSTCHECK (evidence) ════');
  const p = await probe();
  console.log('[prod] v_prov_row FLOOR =', p.floor_count, '/ CEIL =', p.ceil_count, '(기대 FLOOR>=1 / CEIL=0)');
  if (p.floor_count < 1 || p.ceil_count !== 0) throw new Error(`POSTCHECK 실패: ${JSON.stringify(p)}`);
  const line = await q(`
    WITH def AS (SELECT pg_get_functiondef('public.resettle_insurance_grade(uuid,text,boolean,text)'::regprocedure) AS d)
    SELECT (regexp_matches((SELECT d FROM def), '(v_prov_row\\s*:=[^;]+;)', 'i'))[1] AS prov_line`);
  console.log('[prod 실측 라인]', line[0]?.prov_line?.replace(/\s+/g, ' ').trim());
  console.log('POSTCHECK PASS.');
}
