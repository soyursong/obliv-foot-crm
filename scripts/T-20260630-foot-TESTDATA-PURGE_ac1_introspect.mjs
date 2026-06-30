/**
 * T-20260630-foot-TESTDATA-PURGE — AC1 + FK cascade introspection (READ-ONLY)
 *
 * 목적:
 *   AC1) 보존 26개 chart_number 가 customers 에 각 1행 실재하는지 검증.
 *   FK) customers 를 참조하는 모든 자식 테이블 + ON DELETE 동작(CASCADE/RESTRICT/...) 발견.
 *       → cascade hard-delete 시 자동 삭제 vs 수동 선삭제 필요 여부 판정 + 백업 범위 확정.
 *
 * READ-ONLY: SELECT/카탈로그 조회만. 쓰기 0. prod 무영향.
 * 실행: Supabase Management API (/database/query) 경유 (대시보드 수동 실행 금지 정책).
 */
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

async function sql(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    console.error('SQL ERROR', resp.status, JSON.stringify(body));
    throw new Error('SQL failed');
  }
  return body;
}

const PRESERVE = [
  'F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896',
  'F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328',
  'F-4343','F-4344','F-4365','F-4391','F-4380','F-4421',
];
const line = (s = '') => console.log(s);
const H = (s) => { line(); line('━'.repeat(60)); line(s); line('━'.repeat(60)); };

line(`# T-20260630-foot-TESTDATA-PURGE  AC1+FK introspect (READ-ONLY)  ${new Date().toISOString()}`);
line(`# 보존 대상 chart_number: ${PRESERVE.length}개`);

// ── 0. customers PK / chart_number 컬럼 확인 ──
H('0. customers 스키마 (PK + chart_number 컬럼 확인)');
const cols = await sql(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
  ORDER BY ordinal_position`);
const colNames = cols.map(r => r.column_name);
line(`  컬럼수: ${colNames.length}`);
line(`  chart_number 존재: ${colNames.includes('chart_number')}`);
line(`  id 존재: ${colNames.includes('id')}`);
const pk = await sql(`
  SELECT a.attname AS col
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
  WHERE i.indrelid='public.customers'::regclass AND i.indisprimary`);
line(`  PK: ${pk.map(r => r.col).join(', ')}`);

// ── 1. AC1: 보존 26개 chart_number 실재 검증 ──
H('1. AC1 — 보존 26개 chart_number 실재(각 1행) 검증');
const inList = PRESERVE.map(c => `'${c}'`).join(',');
const found = await sql(`
  SELECT chart_number, COUNT(*)::int AS n
  FROM public.customers
  WHERE chart_number IN (${inList})
  GROUP BY chart_number`);
const foundMap = new Map(found.map(r => [r.chart_number, r.n]));
let missing = [], dup = [], ok = 0;
for (const c of PRESERVE) {
  const n = foundMap.get(c) || 0;
  if (n === 0) missing.push(c);
  else if (n > 1) dup.push(`${c}(${n})`);
  else ok++;
}
line(`  정상(1행): ${ok}/26`);
line(`  미존재: ${missing.length ? missing.join(', ') : '없음'}`);
line(`  중복(>1행): ${dup.length ? dup.join(', ') : '없음'}`);
line(`  ★ AC1 판정: ${missing.length === 0 && dup.length === 0 ? '✅ PASS (26개 각 1행)' : '❌ FAIL — 중단·재확인 필요'}`);

// ── 2. FK: customers 를 참조하는 모든 자식 테이블 + ON DELETE 동작 ──
H('2. FK — customers 참조 자식 테이블 + ON DELETE 동작');
const fks = await sql(`
  SELECT
    con.conname            AS constraint_name,
    cl.relname             AS child_table,
    att.attname            AS child_column,
    CASE con.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END                    AS on_delete
  FROM pg_constraint con
  JOIN pg_class cl   ON cl.oid = con.conrelid
  JOIN pg_class pcl  ON pcl.oid = con.confrelid
  JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.attnum
  WHERE con.contype='f'
    AND pcl.relname='customers'
    AND pcl.relnamespace='public'::regnamespace
  ORDER BY on_delete, child_table`);
line(`  customers 직접 참조 FK: ${fks.length}건`);
for (const f of fks) {
  line(`    [${f.on_delete.padEnd(9)}] ${f.child_table}.${f.child_column}  (${f.constraint_name})`);
}
const nonCascade = fks.filter(f => !['CASCADE','SET NULL'].includes(f.on_delete));
line();
line(`  ⚠ CASCADE/SET NULL 아닌 FK (수동 선삭제 필요): ${nonCascade.length}건`);
for (const f of nonCascade) line(`    ${f.child_table}.${f.child_column} [${f.on_delete}]`);

// 자식 테이블 목록 (백업 범위 산정용)
const childTables = [...new Set(fks.map(f => f.child_table))];
line();
line(`  자식 테이블(고유): ${childTables.length}개`);
line(`    ${childTables.join(', ')}`);

console.log('\nINTROSPECT_DONE');
