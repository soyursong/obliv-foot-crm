/**
 * T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT — chart_diagnoses 마이그 DRY-RUN
 * No-Persistence Protocol 준수:
 *   - 마이그를 트랜잭션(BEGIN … ROLLBACK) 안에서 적용 → 구조 introspection → ROLLBACK (영속 0).
 *   - 마이그 파일에 txn-control(COMMIT 등) 없음(sentinel-bypass 불가) 확인.
 *   - PRE/POST 무영속 probe(적용 전·후 모두 테이블 부재)로 실재 non-persistence 검증.
 *   - rollback.sql 대칭성(up→down 후 테이블/인덱스/정책 전량 소거) 검증.
 * 실제 prod apply + DDL-diff = supervisor SQL 게이트. 본 스크립트는 dev 증적 산출용.
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1); }

const UP = fs.readFileSync('supabase/migrations/20260606140000_chart_diagnoses.sql', 'utf8');
const DOWN = fs.readFileSync('supabase/migrations/20260606140000_chart_diagnoses.rollback.sql', 'utf8');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${t}`);
  return j;
}

let pass = true;
const chk = (n, v, extra = '') => { console.log(`  ${v ? '✅' : '❌'} ${n}${extra ? '  ' + extra : ''}`); if (!v) pass = false; };

console.log(`\n=== T-20260606 chart_diagnoses DRY-RUN  (${new Date().toISOString()}) ===\n`);

// 0) txn-control 부재 확인 (sentinel-bypass 차단)
const hasTxnCtrl = /^\s*(BEGIN|COMMIT|END|SAVEPOINT|ROLLBACK)\s*;/im.test(UP);
chk('마이그 파일 내 txn-control 문 없음(COMMIT bypass 불가)', !hasTxnCtrl);

// 1) PRE-PROBE: 적용 전 테이블 부재 (ledger/실재 baseline)
const pre = await q(`SELECT to_regclass('public.chart_diagnoses') IS NOT NULL AS exists;`);
chk('PRE-PROBE — chart_diagnoses 미존재(신규·additive)', pre[0]?.exists === false);

// 2) DRY-RUN: 트랜잭션 안에서 up 적용 후 구조 introspection (ROLLBACK)
const introspect = `
  select json_build_object(
    'table', to_regclass('public.chart_diagnoses') is not null,
    'columns', (select json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable) order by ordinal_position)
                 from information_schema.columns where table_schema='public' and table_name='chart_diagnoses'),
    'checks', (select json_agg(cc.check_clause)
                 from information_schema.table_constraints tc
                 join information_schema.check_constraints cc on cc.constraint_name=tc.constraint_name
                 where tc.table_schema='public' and tc.table_name='chart_diagnoses' and tc.constraint_type='CHECK'
                   and cc.check_clause ilike '%diagnosis_type%'),
    'fks', (select json_agg(json_build_object('col',kcu.column_name,'ref',ccu.table_name,'del',rc.delete_rule))
                 from information_schema.table_constraints tc
                 join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
                 join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
                 join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
                 where tc.table_schema='public' and tc.table_name='chart_diagnoses' and tc.constraint_type='FOREIGN KEY'),
    'indexes', (select json_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename='chart_diagnoses'),
    'policies', (select json_agg(json_build_object('cmd',cmd,'roles',roles,'qual',qual,'wc',with_check) order by cmd) from pg_policies where schemaname='public' and tablename='chart_diagnoses'),
    'rls', (select relrowsecurity from pg_class where oid='public.chart_diagnoses'::regclass)
  ) as info;`;

const dr = await q(`BEGIN;\n${UP}\n${introspect}\nROLLBACK;`);
const info = dr[dr.length - 1]?.info ?? dr[0]?.info;
console.log('\n── DRY-RUN introspection (트랜잭션 내, 미커밋) ──');
console.log(JSON.stringify(info, null, 2));

const cols = (info?.columns ?? []).reduce((m, c) => (m[c.name] = c, m), {});
chk('테이블 생성됨', info?.table === true);
chk('컬럼: chart_id/service_id/diagnosis_type/diagnosis_code/diagnosis_name/seq 존재',
  ['chart_id', 'service_id', 'diagnosis_type', 'diagnosis_code', 'diagnosis_name', 'seq'].every((c) => cols[c]));
chk('diagnosis_name NOT NULL', cols['diagnosis_name']?.nullable === 'NO');
chk('service_id nullable(legacy/미매칭 graceful)', cols['service_id']?.nullable === 'YES');
chk('CHECK diagnosis_type in (primary,secondary)',
  (info?.checks ?? []).some((c) => /primary/.test(c) && /secondary/.test(c)));
const fkChart = (info?.fks ?? []).find((f) => f.col === 'chart_id');
const fkSvc = (info?.fks ?? []).find((f) => f.col === 'service_id');
chk('FK chart_id → medical_charts ON DELETE CASCADE', fkChart?.ref === 'medical_charts' && fkChart?.del === 'CASCADE');
chk('FK service_id → services ON DELETE SET NULL', fkSvc?.ref === 'services' && fkSvc?.del === 'SET NULL');
const idxDefs = info?.indexes ?? [];
chk('인덱스 chart/service 2종', idxDefs.filter((i) => /idx_chart_diagnoses_(chart|service)/.test(i)).length >= 2);
// HARD-2: at-most-one-primary partial-unique
chk('HARD-2 partial-unique uq_chart_diagnoses_one_primary (chart_id) WHERE primary',
  idxDefs.some((i) => /uq_chart_diagnoses_one_primary/.test(i) && /unique/i.test(i) && /where.*diagnosis_type/i.test(i)));
const pols = info?.policies ?? [];
chk('RLS 활성 + 정책 4종(SELECT/INSERT/UPDATE/DELETE)', info?.rls === true && pols.length === 4);
// HARD-1: 부모 clinic 격리 상속 (permissive USING(true) 잔재 없음)
const permissive = pols.some((p) => {
  const q = (p.qual || '') + ' ' + (p.wc || '');
  return /^\s*true\s*$/.test(p.qual || '') || /^\s*true\s*$/.test(p.wc || '');
});
const inheritsParent = pols.every((p) => {
  const expr = ((p.qual || '') + ' ' + (p.wc || ''));
  // SELECT/DELETE use qual; INSERT uses with_check; UPDATE uses both.
  const relevant = p.cmd === 'INSERT' ? (p.wc || '') : (p.qual || '');
  return /medical_charts/.test(relevant) && /current_user_clinic_id/.test(relevant);
});
chk('HARD-1 permissive USING(true)/WITH CHECK(true) 잔재 없음', !permissive);
chk('HARD-1 4정책 전부 부모 medical_charts clinic 격리 상속(current_user_clinic_id)', inheritsParent);
// anon 무권한 — 정책 role 이 authenticated 한정
chk('anon 0 — 모든 정책 TO authenticated 한정', pols.every((p) => Array.isArray(p.roles) ? p.roles.includes('authenticated') && !p.roles.includes('anon') : /authenticated/.test(String(p.roles)) && !/anon/.test(String(p.roles))));

// 3) POST-PROBE: 무영속 확인 (ROLLBACK 후 테이블 여전히 부재)
const post = await q(`SELECT to_regclass('public.chart_diagnoses') IS NOT NULL AS exists;`);
chk('POST-PROBE — ROLLBACK 후 chart_diagnoses 여전히 미존재(무영속)', post[0]?.exists === false);

// 4) ROLLBACK 대칭성: up→down 적용 후 테이블 소거 확인(트랜잭션 내)
const sym = await q(`BEGIN;\n${UP}\n${DOWN}\nSELECT to_regclass('public.chart_diagnoses') IS NOT NULL AS exists;\nROLLBACK;`);
chk('rollback.sql 대칭 — up→down 후 테이블/인덱스/정책 전량 소거', sym[sym.length - 1]?.exists === false);

// 5) 최종 무영속 재확인
const post2 = await q(`SELECT to_regclass('public.chart_diagnoses') IS NOT NULL AS exists;`);
chk('최종 무영속 재확인 — 프로드 실재 미변경', post2[0]?.exists === false);

console.log(`\n=== 결과: ${pass ? '✅ ALL PASS (additive·롤백대칭·무영속)' : '❌ FAIL'} ===\n`);
process.exit(pass ? 0 : 1);
