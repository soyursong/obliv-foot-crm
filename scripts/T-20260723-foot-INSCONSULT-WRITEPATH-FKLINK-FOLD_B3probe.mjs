import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const out={};
out.svc = await q(`
  SELECT service_code, name, category, hira_category, hira_score,
         is_insurance_covered, active, price
  FROM services
  WHERE is_insurance_covered = TRUE
  ORDER BY active DESC, service_code NULLS LAST;
`);
console.log(JSON.stringify(out,null,2));
