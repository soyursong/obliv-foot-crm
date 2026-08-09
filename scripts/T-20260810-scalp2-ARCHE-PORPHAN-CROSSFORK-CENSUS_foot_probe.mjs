/**
 * T-20260810-scalp2-ARCHE-PORPHAN-CROSSFORK-CENSUS — foot fork census (READ-ONLY).
 *
 * 목적(cross-fork): scalp2(foot 하드포크)에서 확정된 P-orphan(package_session_id backlink-NULL)
 *   fragility 가 foot 하드포크 계보 origin(obliv-foot-crm)에도 동형 상속됐는지 READ-ONLY 확인.
 *
 * 불변식 P: is_package_session=true  ⟺  package_session_id IS NOT NULL
 * P-orphan  = is_package_session=true AND package_session_id IS NULL
 *             (backlink 결손 → draw-down offset 결손 phantom)
 *
 * prod write/DDL 0 — SELECT only. 자가 정정 금지(detect-only).
 */
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd'; // obliv-foot-crm prod
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

// (3) per-fork 스키마 대응 확인 — 컬럼 실재 여부
out.schema = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='check_in_services'
    AND column_name IN ('is_package_session','package_session_id')
  ORDER BY column_name;
`);

// (1) count — P-orphan 전수(표본 금지)
out.porphan_count = await q(`
  SELECT COUNT(*) AS porphan_count
  FROM check_in_services
  WHERE is_package_session = true AND package_session_id IS NULL;
`);

// (2) P-orphan PK 목록 — 전수 (환자/체크인 맥락 동봉)
out.porphan_rows = await q(`
  SELECT cis.id AS cis_pk,
         cis.check_in_id,
         cis.service_id,
         cis.service_name,
         cis.created_at,
         ci.customer_id
  FROM check_in_services cis
  LEFT JOIN check_ins ci ON ci.id = cis.check_in_id
  WHERE cis.is_package_session = true AND cis.package_session_id IS NULL
  ORDER BY cis.created_at ASC, cis.id ASC;
`);

// (참고) 불변식 대칭축 & 전체 규모 — 오탐/정상 기저 대비용
out.invariant_frame = await q(`
  SELECT
    COUNT(*) FILTER (WHERE is_package_session = true  AND package_session_id IS NULL)     AS porphan_true_null,
    COUNT(*) FILTER (WHERE is_package_session = false AND package_session_id IS NOT NULL) AS inverse_false_notnull,
    COUNT(*) FILTER (WHERE is_package_session = true  AND package_session_id IS NOT NULL) AS healthy_true_notnull,
    COUNT(*) FILTER (WHERE is_package_session = true)                                      AS total_pkg_flagged,
    COUNT(*)                                                                               AS total_cis_rows
  FROM check_in_services;
`);

// (참고) P-orphan 시계열 분포 — 20260723 forward-fix 전/후 상속 여부 판별
out.porphan_by_month = await q(`
  SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS ym, COUNT(*) AS n
  FROM check_in_services
  WHERE is_package_session = true AND package_session_id IS NULL
  GROUP BY 1 ORDER BY 1;
`);

console.log(JSON.stringify(out, null, 2));
