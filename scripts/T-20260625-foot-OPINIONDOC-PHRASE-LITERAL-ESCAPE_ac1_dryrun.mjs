/**
 * T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE — AC-1 DRY-RUN (READ-ONLY, 적용 안 함)
 * opinion_doc(소견서) field_map 안의 리터럴 \n(2글자) → 실제 개행(0x0A) 교정 계획.
 * - before/after diff 출력
 * - 적용 UPDATE SQL + 롤백 SQL 파일 생성 (실행 X — supervisor DB게이트 + 의료 confirm 게이트 통과 후 별도 apply)
 * 스키마 변경 0 (DDL 없음, field_map JSONB 1행 UPDATE).
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P) { for (const l of fs.readFileSync('.env','utf8').split('\n')) { const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if(m)P=m[1].trim(); } }
const c = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });
await c.connect();
console.log(`✅ DB 연결 (DRY-RUN, 적용 안 함)  ${new Date().toISOString()}\n`);

const LITERAL_NL = /\\n/g;        // backslash+n 2글자 → 실제 개행
const HTML_ENT = /&(lt|gt|amp|quot|#\d+);/;

// field_map 트리에서 리터럴\n/엔티티 포함 문자열을 교정한 새 트리 반환 + 변경 카운트
let changed = 0; const diffs = [];
function fix(node, path) {
  if (typeof node === 'string') {
    let v = node;
    if (LITERAL_NL.test(v) || HTML_ENT.test(v)) {
      const before = v;
      // 1) 리터럴 \n → 실제 개행
      let after = before.replace(/\\n/g, '\n');
      // 2) HTML 엔티티 디코드 (현재 form_templates엔 0건이나 방어적 포함)
      after = after.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
      if (after !== before) { changed++; diffs.push({ path, before, after }); }
      return after;
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((v,i)=>fix(v, path+`[${i}]`));
  if (node && typeof node === 'object') { const o={}; for(const k of Object.keys(node)) o[k]=fix(node[k], path+'.'+k); return o; }
  return node;
}

const rows = (await c.query(
  `SELECT id, form_key, name_ko, field_map FROM form_templates WHERE form_key='opinion_doc'`)).rows;

const updateStmts = []; const rollbackStmts = [];
for (const r of rows) {
  const before = r.field_map;
  changed = 0; diffs.length = 0;
  const after = fix(before, '');
  console.log(`\n━━━ ${r.form_key} (id=${r.id}, "${r.name_ko}") : ${diffs.length}건 교정 ━━━`);
  for (const d of diffs) {
    console.log(`\n  · ${d.path}`);
    console.log(`    BEFORE: ${JSON.stringify(d.before).slice(0,200)}`);
    console.log(`    AFTER : ${JSON.stringify(d.after).slice(0,200)}`);
  }
  // 적용/롤백 SQL (jsonb 전체 치환 — 안전한 단일 UPDATE)
  const afterJson = JSON.stringify(after).replace(/'/g, "''");
  const beforeJson = JSON.stringify(before).replace(/'/g, "''");
  updateStmts.push(`UPDATE public.form_templates SET field_map='${afterJson}'::jsonb WHERE id='${r.id}'; -- ${r.form_key} ${diffs.length}건`);
  rollbackStmts.push(`UPDATE public.form_templates SET field_map='${beforeJson}'::jsonb WHERE id='${r.id}'; -- ROLLBACK ${r.form_key}`);
}

const applySql = `-- T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE AC-1 APPLY\n-- 생성: ${new Date().toISOString()} (dry-run, 미실행)\nBEGIN;\n${updateStmts.join('\n')}\nCOMMIT;\n`;
const rollbackSql = `-- T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE AC-1 ROLLBACK\nBEGIN;\n${rollbackStmts.join('\n')}\nCOMMIT;\n`;
fs.writeFileSync('scripts/T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE_ac1_apply.sql', applySql);
fs.writeFileSync('scripts/T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE_ac1_rollback.sql', rollbackSql);
console.log(`\n\n════════ AC-1 DRY-RUN 요약 ════════`);
console.log(`교정 대상: opinion_doc 1 template`);
console.log(`apply SQL  → scripts/...ac1_apply.sql`);
console.log(`rollback   → scripts/...ac1_rollback.sql`);
console.log(`⚠️ 적용 안 함 — 의료 confirm 게이트 + supervisor DB게이트 통과 후 별도 apply 스크립트로 실행`);
await c.end();
