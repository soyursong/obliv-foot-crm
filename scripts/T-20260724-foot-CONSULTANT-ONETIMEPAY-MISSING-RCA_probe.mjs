/**
 * T-20260724-foot-CONSULTANT-TKTREV-ONETIMEPAY-MISSING-RCA — READ-ONLY RCA probe.
 * 1회성 결제(단회 패키지/단건)가 '상담실장 티켓팅 실적'(foot_stats_consultant)에서
 * 전부 누락되는지 판별. SELECT only, DB 무변경.
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

// 0) clinic_id 확인 (foot 단일 지점, 종로)
out.clinics = await q(`SELECT id, name, slug FROM clinics ORDER BY created_at LIMIT 10;`);

// 1) 스키마 — packages / package_templates / package_payments 컬럼
out.pkg_cols = await q(`
  SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('packages','package_templates','package_payments','payments')
  ORDER BY table_name, ordinal_position;`);

// 2) package_templates 회차수 관련 컬럼 값 분포 (1회성 정의 후보)
out.tmpl_sample = await q(`
  SELECT * FROM package_templates LIMIT 3;`);

console.log(JSON.stringify(out, null, 2));
