/**
 * T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH — data_correction_guard READ-ONLY probe.
 * 목적: (a)freeze-set 확인 — clinic_doctors WHERE name='문지은' 대상행 수(예상1,>1중단)
 *       (b)기존 seal_image_url 캡처(롤백용) (c)회귀대조 — 타 의사 seal 상태.
 * READ-ONLY. 실제 UPDATE/upload 없음.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};
out.moon_rows = await q(`SELECT id, name, is_default, seal_image_url, clinic_id FROM public.clinic_doctors WHERE name='문지은' ORDER BY id;`);
out.moon_count = out.moon_rows.length;
out.all_doctors = await q(`SELECT id, name, is_default, seal_image_url FROM public.clinic_doctors ORDER BY name;`);
console.log(JSON.stringify(out, null, 2));
