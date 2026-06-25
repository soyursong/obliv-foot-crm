/**
 * T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE — AC-0 트리아지 (READ-ONLY)
 * form_templates 전수 스캔: field_map JSONB 안에서 리터럴 \n(backslash+n 2글자) ·
 * HTML 엔티티(&lt; &gt; &amp; &quot;)를 포함한 모든 텍스트 노드를 식별.
 * 데이터/스키마 변경 없음 (SELECT only).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const LITERAL_NL = /\\n/;                       // backslash + n (2글자)
const HTML_ENT = /&(lt|gt|amp|quot|#\d+);/;     // HTML 엔티티

// JSONB 트리를 재귀 순회하며 문자열 노드의 경로+값 수집
function walk(node, path, out) {
  if (typeof node === 'string') {
    if (LITERAL_NL.test(node) || HTML_ENT.test(node)) {
      out.push({ path: path.join('.'), value: node });
    }
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, [...path, `[${i}]`], out));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) walk(node[k], [...path, k], out);
  }
}

const c = conn();
await c.connect();
console.log(`✅ DB 연결 (READ-ONLY scan)  ${new Date().toISOString()}\n`);

// 컬럼 구조 확인
const cols = await c.query(
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='form_templates' ORDER BY ordinal_position`);
console.log('── form_templates 컬럼 ──');
console.log(cols.rows.map(r => `${r.column_name}:${r.data_type}`).join(', '));

const rows = (await c.query(
  `SELECT id, form_key, name_ko AS name, field_map FROM form_templates ORDER BY form_key`)).rows;
console.log(`\n총 ${rows.length}개 템플릿 로드\n`);

let totalHits = 0;
const affectedForms = new Set();
for (const r of rows) {
  const hits = [];
  walk(r.field_map, [], hits);
  if (hits.length === 0) continue;
  affectedForms.add(r.form_key);
  totalHits += hits.length;
  console.log(`\n━━━ form_key=${r.form_key} (id=${r.id}, name="${r.name}") : ${hits.length}건 ━━━`);
  for (const h of hits) {
    const flags = [];
    if (LITERAL_NL.test(h.value)) flags.push('LIT\\n');
    if (HTML_ENT.test(h.value)) flags.push('HTMLENT');
    // value 미리보기 (JSON.stringify로 리터럴 \n 가시화)
    const preview = JSON.stringify(h.value).slice(0, 160);
    console.log(`  [${flags.join(',')}] ${h.path}`);
    console.log(`      ${preview}`);
  }
}

console.log(`\n\n════════ AC-0 요약 ════════`);
console.log(`영향 template 수: ${affectedForms.size}`);
console.log(`영향 form_key: ${[...affectedForms].join(', ') || '(없음)'}`);
console.log(`리터럴/엔티티 포함 텍스트 노드 총 ${totalHits}건`);

await c.end();
