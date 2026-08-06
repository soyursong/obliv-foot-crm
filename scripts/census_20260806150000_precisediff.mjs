/**
 * census_20260806150000_precisediff.mjs (READ-ONLY)
 * 현재 prod 4함수 prosrc 를 target 마이그 .sql 본문(AS $$ ... $$)과 정밀 대조.
 *   목적: prod 가 (a) 이미 target 과 동일(이미 적용/OOB-persist) 인지 (b) 제3 버전인지 확정.
 * author: dev-foot / 2026-08-06
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '../supabase/migrations/20260806150000_foot_closing_herald_totals_recompute_port.sql');
const sql = readFileSync(sqlPath, 'utf8');
const md5 = (s) => createHash('md5').update(s).digest('hex');
const rows = async (q) => { const r = await query(q); return Array.isArray(r) ? r : []; };

// .sql 에서 각 함수의 AS $$ ... $$ 본문 추출
function extractBody(fnName) {
  // CREATE OR REPLACE FUNCTION public.<fnName>(...) ... AS $$ <body> $$;
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'm');
  const m = sql.match(re);
  return m ? m[1] : null;
}

const FNS = [
  ['closing_source_split', "(uuid,date)"],
  ['closing_insurance_split', "(uuid,date)"],
  ['closing_month_projection', "(uuid,date)"],
  ['enqueue_closing_confirmed', ''],
];

console.log('════ PRECISE DIFF: prod prosrc vs target .sql body ════\n');
const norm = (s) => s.replace(/\r\n/g, '\n');
let allIdentical = true;
for (const [name, sig] of FNS) {
  const targetBody = extractBody(name);
  const regproc = sig ? `public.${name}${sig}` : `public.${name}()`;
  const prod = (await rows(`SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='${name}' LIMIT 1;`))[0]?.prosrc;
  if (targetBody == null || prod == null) {
    console.log(`  ${name}: ⚠ 추출 실패 (target=${targetBody!=null} prod=${prod!=null})`);
    allIdentical = false;
    continue;
  }
  const tb = norm(targetBody), pb = norm(prod);
  const identical = tb === pb;
  if (!identical) allIdentical = false;
  console.log(`── ${name}(${sig || 'trigger'}) ──`);
  console.log(`   target.sql body md5 = ${md5(tb)}`);
  console.log(`   prod prosrc     md5 = ${md5(pb)}`);
  console.log(`   identical = ${identical ? '✅ YES (prod == target)' : '❌ NO'}`);
  if (!identical) {
    // 첫 불일치 위치
    let i = 0; const min = Math.min(tb.length, pb.length);
    while (i < min && tb[i] === pb[i]) i++;
    console.log(`   len target=${tb.length} prod=${pb.length}, first diff @${i}`);
    console.log(`   target[${i}..]: ${JSON.stringify(tb.slice(i, i+80))}`);
    console.log(`   prod  [${i}..]: ${JSON.stringify(pb.slice(i, i+80))}`);
  }
  console.log('');
}
console.log('── VERDICT ──');
console.log(allIdentical
  ? '✅ prod 4함수 == target .sql 본문 IDENTICAL → target 산식이 이미 prod 실재(ledger 미기록 divergence).'
  : '❌ prod 4함수 중 target 과 불일치 존재 → 제3 버전 가능성. 상세 diff 확인 필요.');
