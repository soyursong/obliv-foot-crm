/**
 * T-20260630-foot-TESTDATA-PURGE — FK 전이폐포 발견 + 삭제대상 행수 집계 (READ-ONLY)
 *
 * customers 를 루트로 incoming FK 간선을 BFS 하여 전체 의존 폐포(손자·증손자 포함)를 발견.
 * 각 테이블에서 "삭제대상 customers(보존26 제외)에 전이적으로 묶인 행수"를 집계.
 * 삭제 순서(reverse topo) 산정 + AC2 백업 범위 + AC3 dry-run 상세 근거.
 *
 * READ-ONLY: SELECT/카탈로그만. 쓰기 0.
 */
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();
import { writeFileSync } from 'fs';

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const b = await r.json(); if (!r.ok) { console.error('SQL ERR', r.status, JSON.stringify(b)); throw new Error('SQL failed'); } return b;
}
const line = (s='') => console.log(s);

// ── 모든 FK 간선 (public 스키마) ──
const allEdges = await sql(`
  SELECT con.conname AS cname,
         cl.relname  AS child_table,
         att.attname AS child_col,
         pcl.relname AS parent_table,
         patt.attname AS parent_col,
         CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
              WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
  FROM pg_constraint con
  JOIN pg_class cl  ON cl.oid = con.conrelid
  JOIN pg_class pcl ON pcl.oid = con.confrelid
  JOIN unnest(con.conkey)  WITH ORDINALITY AS ck(attnum,ord) ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum,ord2) ON ck.ord=fk.ord2
  JOIN pg_attribute att  ON att.attrelid=con.conrelid  AND att.attnum=ck.attnum
  JOIN pg_attribute patt ON patt.attrelid=con.confrelid AND patt.attnum=fk.attnum
  WHERE con.contype='f' AND cl.relnamespace='public'::regnamespace
  ORDER BY child_table`);
line(`# 전체 public FK 간선: ${allEdges.length}`);

// ── BFS: customers 루트에서 incoming 간선으로 폐포 발견 ──
// 노드: 테이블. edge(child→parent). 루트 customers 의 자손(=customers 를 직간접 참조)들을 수집.
const edgesByParent = new Map();
for (const e of allEdges) {
  if (!edgesByParent.has(e.parent_table)) edgesByParent.set(e.parent_table, []);
  edgesByParent.get(e.parent_table).push(e);
}
// closure edges: 루트 customers 에서 도달 가능한 child 방향 간선만
const visited = new Set(['customers']);
const queue = ['customers'];
const closureEdges = [];
while (queue.length) {
  const parent = queue.shift();
  for (const e of (edgesByParent.get(parent) || [])) {
    // self-ref(customers.referrer_id→customers) 는 간선기록만, 재방문 안함
    closureEdges.push(e);
    if (!visited.has(e.child_table)) { visited.add(e.child_table); queue.push(e.child_table); }
  }
}
const closureTables = [...visited].filter(t => t !== 'customers');
line(`# 폐포 테이블(customers 제외): ${closureTables.length}`);
line(`# 폐포 간선: ${closureEdges.length}`);

// depth 계산 (customers=0). reverse-topo 삭제순서용.
const depth = new Map([['customers', 0]]);
let changed = true, guard = 0;
while (changed && guard++ < 50) {
  changed = false;
  for (const e of closureEdges) {
    const pd = depth.get(e.parent_table);
    if (pd === undefined) continue;
    const nd = pd + 1;
    if ((depth.get(e.child_table) ?? -1) < nd) { depth.set(e.child_table, nd); changed = true; }
  }
}

line('\n=== 폐포 간선 (child.col → parent [on_delete], depth) ===');
const sorted = [...closureEdges].sort((a,b) => (depth.get(b.child_table)-depth.get(a.child_table)));
for (const e of sorted) {
  line(`  d${depth.get(e.child_table)} [${e.on_delete.padEnd(9)}] ${e.child_table}.${e.child_col} → ${e.parent_table}.${e.parent_col}`);
}

// ── 삭제대상 customer ids: 보존26 chart_number 제외 전체 ──
const PRESERVE = ['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421'];
const inList = PRESERVE.map(c=>`'${c}'`).join(',');

// 각 테이블별 "삭제대상 customers 에 직접 묶인 행수" — 직접 customer_id/patient_id 컬럼 기준.
// (전이 손자는 부모 경유. 여기선 customers 직접참조 컬럼이 있는 테이블만 직접집계, 그 외는 부모 경유 표시)
line('\n=== 테이블별 삭제대상 행수 (customers 직접참조 컬럼 기준) ===');
const directRefCols = new Map(); // table -> [cols referencing customers]
for (const e of closureEdges) {
  if (e.parent_table === 'customers') {
    if (!directRefCols.has(e.child_table)) directRefCols.set(e.child_table, []);
    directRefCols.get(e.child_table).push({ col: e.child_col, on_delete: e.on_delete });
  }
}
const directCounts = {};
for (const [t, cols] of directRefCols) {
  for (const c of cols) {
    const q = `SELECT COUNT(*)::int n FROM public.${t}
      WHERE "${c.col}" IN (SELECT id FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList}))`;
    const r = await sql(q);
    directCounts[`${t}.${c.col}`] = { n: r[0].n, on_delete: c.on_delete };
    line(`  ${t}.${c.col} [${c.on_delete}]: ${r[0].n}`);
  }
}

writeFileSync(new URL('../scripts/_purge_closure_report.json', import.meta.url),
  JSON.stringify({ closureTables, closureEdges, depth: Object.fromEntries(depth), directCounts }, null, 2));
line('\nCLOSURE_DONE → scripts/_purge_closure_report.json');
