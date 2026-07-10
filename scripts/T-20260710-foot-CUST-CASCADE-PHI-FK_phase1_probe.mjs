/**
 * T-20260710-foot-CUST-CASCADE-PHI-FK — Phase 1 PROBE (READ-ONLY)
 *
 * 목적(게이트 P1-a~d): prod(rxlomoozakkjesdqjtvd) 실재 근거 회수. blind apply 금지.
 *   P1-a: customers-참조 자식 FK 실재 재확인 — CORE PHI 8 FK + confdeltype 분포('c'=CASCADE).
 *   P1-b: orphan 재검증 — 전 CASCADE FK 자식 중 customers 부모 부재 dangling count(=0 재확인).
 *   P1-c: 경계 3종 컬럼 실측 — insurance_claims / customer_reservation_memos / reservation_memo_history.
 *   P1-d: 라이더 실측 — consultation_notes.customer_id 컬럼 존재 + FK constraint 부재(unconstrained)
 *          + dangling(customers 부재 customer_id) count.
 *
 * 판정근거=prod pg_constraint 실재. 삭제/변경 0(READ-ONLY, SELECT-only).
 * 실행: node scripts/T-20260710-foot-CUST-CASCADE-PHI-FK_phase1_probe.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
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
  const body = await resp.json();
  if (!resp.ok) { console.error('❌ query 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
  return body;
}

const CORE_PHI_8 = ['clinical_images','treatment_photos','health_q_results','patient_past_history',
  'patient_file_records','customer_treatment_memos','customer_consult_memos','customer_special_notes'];
const BOUNDARY_3 = ['insurance_claims','customer_reservation_memos','reservation_memo_history'];

console.log(`\n================ Phase1 PROBE (READ-ONLY) — foot prod ${PROJ_REF} ================`);
console.log(`ts=${new Date().toISOString()}\n`);

// ── P1-a: customers-참조 자식 FK 전수 + confdeltype 분포 ──────────────────────
// confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
const fkAll = await q(`
  SELECT con.conname,
         chld.relname   AS child_table,
         att.attname    AS child_col,
         con.confdeltype AS del_rule
    FROM pg_constraint con
    JOIN pg_class  chld ON chld.oid = con.conrelid
    JOIN pg_class  par  ON par.oid  = con.confrelid
    JOIN pg_namespace ns ON ns.oid = chld.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.attnum
   WHERE con.contype='f' AND ns.nspname='public' AND par.relname='customers'
   ORDER BY con.confdeltype, chld.relname;`);
const rows = fkAll.result ?? fkAll;
const rule = { a:'NO ACTION', r:'RESTRICT', c:'CASCADE', n:'SET NULL', d:'SET DEFAULT' };
const dist = {};
for (const r of rows) dist[r.del_rule] = (dist[r.del_rule]||0)+1;
console.log(`[P1-a] customers-참조 자식 FK 총 ${rows.length}건. del-rule 분포:`);
for (const k of Object.keys(dist)) console.log(`   ${(rule[k]||k).padEnd(12)} = ${dist[k]}`);
console.log(`\n   ▸ CORE PHI 8 FK 실재 + del_rule:`);
const found = {};
for (const r of rows) {
  if (CORE_PHI_8.includes(r.child_table)) {
    found[r.child_table] = r.del_rule;
    console.log(`     ${r.child_table.padEnd(28)} ${r.child_col.padEnd(14)} ${rule[r.del_rule]||r.del_rule}  (${r.conname})`);
  }
}
const missing = CORE_PHI_8.filter(t => !(t in found));
console.log(`   ▸ CORE PHI 8 실재: ${Object.keys(found).length}/8 ${missing.length? '⚠누락='+missing.join(','):'✅'}`);
const notCascade = Object.entries(found).filter(([,d]) => d!=='c').map(([t,d])=>`${t}=${rule[d]}`);
console.log(`   ▸ CORE PHI 8 중 CASCADE(c) 아님: ${notCascade.length? '⚠ '+notCascade.join(', '):'0 (전부 CASCADE ✅)'}`);

console.log(`\n   ▸ 경계 3 FK del_rule:`);
for (const r of rows) if (BOUNDARY_3.includes(r.child_table))
  console.log(`     ${r.child_table.padEnd(28)} ${r.child_col.padEnd(14)} ${rule[r.del_rule]||r.del_rule}  (${r.conname})`);

console.log(`\n   ▸ 전체 CASCADE(c) FK 목록:`);
const cascadeFks = rows.filter(r => r.del_rule==='c');
for (const r of cascadeFks) console.log(`     ${r.child_table.padEnd(30)} .${r.child_col}`);

// ── P1-b: orphan 재검증 — 전 CASCADE FK 자식 중 customers 부모 부재 dangling ──
console.log(`\n[P1-b] orphan 재검증 (전 CASCADE FK ${cascadeFks.length}건 — customers 부모 부재 dangling):`);
let totalOrphan = 0;
for (const r of cascadeFks) {
  const oq = await q(`SELECT count(*)::int AS n FROM public."${r.child_table}" c
     WHERE c."${r.child_col}" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id = c."${r.child_col}");`);
  const n = (oq.result ?? oq)[0].n;
  totalOrphan += n;
  console.log(`     ${r.child_table.padEnd(30)} .${r.child_col.padEnd(14)} orphan=${n} ${n>0?'⚠':'✅'}`);
}
console.log(`   ▸ 전 CASCADE orphan 합계 = ${totalOrphan} ${totalOrphan===0?'✅ (게이트 A 성립: archive-first 불요)':'⚠ (정합 정리 선행 DA 상신 필요)'}`);

// ── P1-c: 경계 3종 컬럼 실측 ──────────────────────────────────────────────────
console.log(`\n[P1-c] 경계 3종 컬럼 실측 (DA §550 IN/OUT 판정 근거):`);
for (const t of BOUNDARY_3) {
  const cq = await q(`SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='${t}' ORDER BY ordinal_position;`);
  const cols = (cq.result ?? cq);
  console.log(`   ▸ ${t} (${cols.length} cols):`);
  console.log(`     ${cols.map(c=>`${c.column_name}:${c.data_type}`).join(', ')}`);
}

// ── P1-d: 라이더 — consultation_notes FK 부재 + dangling ──────────────────────
console.log(`\n[P1-d] 라이더 — consultation_notes:`);
const cnExist = await q(`SELECT count(*)::int AS n FROM information_schema.tables
   WHERE table_schema='public' AND table_name='consultation_notes';`);
if ((cnExist.result ?? cnExist)[0].n === 0) {
  console.log(`   ⚠ consultation_notes 테이블 부재 — 라이더 scope 재확인 필요`);
} else {
  const cnCols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='consultation_notes' ORDER BY ordinal_position;`);
  const cols = (cnCols.result ?? cnCols);
  console.log(`   ▸ 컬럼(${cols.length}): ${cols.map(c=>`${c.column_name}:${c.data_type}${c.is_nullable==='YES'?'?':''}`).join(', ')}`);
  const hasCustCol = cols.some(c => c.column_name === 'customer_id');
  console.log(`   ▸ customer_id 컬럼 존재: ${hasCustCol?'✅':'⚠ 부재'}`);

  // 기존 customers-참조 FK 있는지
  const cnFk = await q(`
    SELECT con.conname, att.attname AS col, con.confdeltype AS del_rule, par.relname AS parent
      FROM pg_constraint con
      JOIN pg_class chld ON chld.oid=con.conrelid
      JOIN pg_class par ON par.oid=con.confrelid
      JOIN pg_namespace ns ON ns.oid=chld.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum,ord) ON true
      JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=ck.attnum
     WHERE con.contype='f' AND ns.nspname='public' AND chld.relname='consultation_notes';`);
  const fks = (cnFk.result ?? cnFk);
  console.log(`   ▸ consultation_notes FK 총 ${fks.length}건: ${fks.map(f=>`${f.col}→${f.parent}(${rule[f.del_rule]})`).join(', ')||'(없음)'}`);
  const custFk = fks.find(f => f.parent === 'customers');
  console.log(`   ▸ customers FK 부재(unconstrained) 여부: ${custFk?`⚠ 이미 존재(${custFk.conname}, ${rule[custFk.del_rule]})`:'✅ 부재 확인 — ADD FK 라이더 대상'}`);

  if (hasCustCol && !custFk) {
    const dq = await q(`SELECT count(*)::int AS n FROM public.consultation_notes c
       WHERE c.customer_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id = c.customer_id);`);
    const nd = (dq.result ?? dq)[0].n;
    const totalq = await q(`SELECT count(*)::int AS n FROM public.consultation_notes;`);
    console.log(`   ▸ 전체 행=${(totalq.result??totalq)[0].n}, dangling(customers 부재 customer_id)=${nd} ${nd===0?'✅ ADD FK 즉시 가능':'⚠ 정합 정리 선행 DA 상신'}`);
  }
}

console.log(`\n================ Phase1 PROBE 종료 (READ-ONLY, 변경 0) ================\n`);
