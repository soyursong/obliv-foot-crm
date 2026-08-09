// 3자 원장 대조 — T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE (a)
//   Migration Ledger Reconciliation: (1)파일 선언 ↔ (2)schema_migrations 원장 ↔ (3)prod 실재.
//   apply 전 = 3자 정합 = "미적용": 파일 존재 / 원장 부재 / prod default='returning'.
//   (apply 후 supervisor postcheck = 파일 존재 / 원장 존재 / prod default='new'.)
//
// usage: (repo root) node db-gate/T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE_ledger_check.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260809120000';
const NAME = 'foot_reservations_visittype_default_setnew';
const MIG = join('supabase/migrations', `${VERSION}_${NAME}.sql`);

function pat() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return readFileSync(process.env.HOME + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim();
}
const PAT = pat();
async function runq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return r.json();
}

let fail = 0;
const chk = (cond, label, detail) => { console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };

// (1) 파일 선언
const fileExists = existsSync(MIG);
const hasSetNew = fileExists && /ALTER\s+COLUMN\s+visit_type\s+SET\s+DEFAULT\s+'new'/i.test(readFileSync(MIG, 'utf8'));
console.log('== (1) 파일 선언 ==');
chk(fileExists, `마이그 파일 실재: ${VERSION}_${NAME}.sql`);
chk(hasSetNew, "파일이 SET DEFAULT 'new' 선언");

// (2) schema_migrations 원장
const led = await runq(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`);
console.log('== (2) 원장 ==', JSON.stringify(led));
const inLedger = Array.isArray(led) && led.length > 0;

// (3) prod 실재
const prodDef = (await runq(`SELECT pg_get_expr(d.adbin,d.adrelid) AS def
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname='reservations' AND a.attname='visit_type'`))?.[0]?.def;
console.log('== (3) prod default ==', prodDef);

// 3자 정합 판정
console.log('\n== 3자 정합 판정 ==');
if (!inLedger && prodDef === "'returning'::text") {
  chk(true, "PRE-APPLY 정합: 원장 부재 + prod default='returning' + 파일 존재 (미적용 일관)", `ledger=${inLedger} prod=${prodDef}`);
} else if (inLedger && prodDef === "'new'::text") {
  chk(true, "POST-APPLY 정합: 원장 존재 + prod default='new' + 파일 존재 (적용 완료 일관)", `ledger=${inLedger} prod=${prodDef}`);
} else {
  chk(false, '3자 divergence 감지 — 조사 필요', `ledger=${inLedger} prod=${prodDef}`);
}

console.log(`\n==== LEDGER-CHECK ${fail === 0 ? 'PASS(3자 정합)' : 'FAIL(' + fail + ')'} ====`);
process.exit(fail === 0 ? 0 : 1);
