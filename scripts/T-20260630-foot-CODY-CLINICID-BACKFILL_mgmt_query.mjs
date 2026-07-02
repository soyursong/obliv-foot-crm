/**
 * T-20260630-foot-CODY-CLINICID-BACKFILL — Management API SQL runner
 * dev-foot 직접 prod 실행(supervisor MSG-20260702 DB-GATE-APPROVED, PHI 경로 직접 집행).
 * usage: node scripts/..._mgmt_query.mjs <sqlfile|-> [--inline "SQL"]
 * 토큰: .env.local SUPABASE_ACCESS_TOKEN. 결과 JSON 그대로 출력. HTTP!=200 시 exit 2.
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
if (!TOKEN) { console.error('❌ missing SUPABASE_ACCESS_TOKEN'); process.exit(1); }

const arg = process.argv[2];
let sql;
if (arg === '--inline') sql = process.argv[3];
else if (arg === '-') sql = fs.readFileSync(0, 'utf8');
else sql = fs.readFileSync(arg, 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log('HTTP', res.status);
console.log(text);
if (res.status !== 200 && res.status !== 201) process.exit(2);
