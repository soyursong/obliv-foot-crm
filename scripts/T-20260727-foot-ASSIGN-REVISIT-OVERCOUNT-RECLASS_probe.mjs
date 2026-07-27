/**
 * T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — Phase 1 READ-ONLY 진단
 * Supabase Management API 경유 순수 SELECT 러너. UPDATE/DDL 금지(가드 내장).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
export async function q(sql) {
  // READ-ONLY 가드 — 파괴적 키워드 차단
  if (/\b(update|delete|insert|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)) {
    throw new Error('READ-ONLY 러너 — 변형 키워드 차단됨: ' + sql.slice(0, 80));
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt}`);
  return JSON.parse(txt);
}
// 직접 실행 시 argv[2] SQL 실행
if (process.argv[2]) {
  q(process.argv[2]).then((rows) => console.log(JSON.stringify(rows, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
