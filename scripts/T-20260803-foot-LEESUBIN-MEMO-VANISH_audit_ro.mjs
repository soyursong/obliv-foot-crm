/**
 * T-20260803-foot-LEESUBIN-MEMO-VANISH-FOOTDB-AUDIT — READ-ONLY audit runner
 * HARD READ-ONLY: refuses any non-SELECT/WITH statement. No write/DDL.
 * usage: node scripts/..._audit_ro.mjs --inline "SELECT ..."  |  - (stdin)
 * 토큰: .env.local SUPABASE_ACCESS_TOKEN. 결과 JSON 그대로 출력.
 */
import fs from 'fs';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

const TOKEN = envFromLocal('SUPABASE_ACCESS_TOKEN');
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOKEN) { console.error('missing SUPABASE_ACCESS_TOKEN'); process.exit(1); }

const arg = process.argv[2];
let sql;
if (arg === '--inline') sql = process.argv[3];
else if (arg === '-') sql = fs.readFileSync(0, 'utf8');
else sql = fs.readFileSync(arg, 'utf8');

// READ-ONLY guard: strip comments, ensure every statement starts with SELECT or WITH.
const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const stmts = stripped.split(';').map(s => s.trim()).filter(Boolean);
const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|upsert|copy)\b/i;
for (const s of stmts) {
  if (!/^(select|with)\b/i.test(s)) { console.error('BLOCKED non-read stmt:', s.slice(0, 80)); process.exit(3); }
  if (forbidden.test(s)) { console.error('BLOCKED write keyword:', s.slice(0, 80)); process.exit(3); }
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log('HTTP', res.status);
console.log(text);
if (res.status !== 200 && res.status !== 201) process.exit(2);
