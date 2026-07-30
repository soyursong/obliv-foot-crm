/**
 * T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG — READ-ONLY 진단 probe.
 * 인증컨텍스트: Supabase Management API (database/query) = postgres 권한, RLS 미적용.
 *   (진단 인증컨텍스트 표준 준수 — anon 0-row 오독 방지, 명시적으로 postgres 컨텍스트로 실행)
 * 목적:
 *   D5) 고객관리 담당자 소스 컬럼 disambiguation — customers.assigned_staff_id vs assigned_consultant_id 별개 확인.
 *   D3) 양종필(F-0155) 실제 assigned_staff_id / assigned_consultant_id 값 + 이름 resolve.
 *   D4) '담당자 없음 인식인데 값 있음' 오귀속 범위 count.
 * READ-ONLY (SELECT only). 데이터/스키마 무변경.
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

// D5) 두 컬럼 존재 여부 (별개 컬럼인지 확정)
out.D5_cols = await q(`
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND column_name IN ('assigned_staff_id','assigned_consultant_id','consultant_id')
  ORDER BY column_name;
`);

// D3) 양종필(F-0155) 실제 값 + 이름 resolve. 이름 검색도 병행(차트번호 불일치 대비).
out.D3_yang_by_chart = await q(`
  SELECT c.id, c.chart_number, c.name,
         c.assigned_staff_id, s1.name AS assigned_staff_name, s1.active AS staff_active, s1.role AS staff_role,
         c.assigned_consultant_id, s2.name AS assigned_consultant_name
  FROM customers c
  LEFT JOIN staff s1 ON s1.id = c.assigned_staff_id
  LEFT JOIN staff s2 ON s2.id = c.assigned_consultant_id
  WHERE c.chart_number = 'F-0155' OR c.name = '양종필'
  ORDER BY c.chart_number;
`);

// D4) 오귀속 범위: assigned_staff_id 가 non-null 인 고객 규모 + 그중 담당자 이름 분포(김수린 편중 여부).
out.D4_scope_total = await q(`
  SELECT
    COUNT(*) AS total_customers,
    COUNT(assigned_staff_id) AS with_staff_id,
    COUNT(assigned_consultant_id) AS with_consultant_id,
    COUNT(*) FILTER (WHERE assigned_staff_id IS NOT NULL AND assigned_consultant_id IS NULL) AS staff_only,
    COUNT(*) FILTER (WHERE assigned_staff_id IS NULL AND assigned_consultant_id IS NOT NULL) AS consultant_only
  FROM customers
  WHERE is_simulation IS NOT TRUE;
`);

// D4b) assigned_staff_id 이름별 분포 (특정 실장 편중 = 자동 채워짐 지문)
out.D4_staff_dist = await q(`
  SELECT s.name AS staff_name, s.role, COUNT(*) AS cust_count
  FROM customers c JOIN staff s ON s.id = c.assigned_staff_id
  WHERE c.is_simulation IS NOT TRUE
  GROUP BY s.name, s.role
  ORDER BY cust_count DESC
  LIMIT 20;
`);

// D4c) 김수린 staff_id + 그가 담당(assigned_staff_id)으로 잡힌 고객 수
out.D4_kimsurin = await q(`
  SELECT s.id, s.name, s.role, s.active,
    (SELECT COUNT(*) FROM customers c WHERE c.assigned_staff_id = s.id AND c.is_simulation IS NOT TRUE) AS assigned_cust
  FROM staff s WHERE s.name = '김수린';
`);

console.log(JSON.stringify(out, null, 2));
