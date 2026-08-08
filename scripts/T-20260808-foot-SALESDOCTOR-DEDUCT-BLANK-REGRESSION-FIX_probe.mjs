/**
 * T-20260808-foot-SALESDOCTOR-DEDUCT-BLANK-REGRESSION-FIX — PROD 증거기반 probe (READ-ONLY)
 * 목적: 담당치료사별 '차감 매출' 전건 0/blank 회귀의 발생 단계 특정.
 *   회귀 diff = fec971f4 (SalesStaffTab): deductSessions 쿼리에 `.is('deleted_at', null)` 추가.
 * 검증:
 *   (1) package_sessions.deleted_at 컬럼 실재 여부 (부재면 PostgREST 400 → deductSessions empty → 전건 0/blank)
 *   (2) status='used' AND performed_by NOT NULL 최근 차감건의 deleted_at 분포 (NULL vs NOT NULL)
 *       → deleted_at 전건 세팅(populated)이면 IS NULL 필터가 전건 wipe
 *   (3) deleted_at 컬럼 default/의미 확인 (soft-delete 컬럼인지, populate 방식)
 * author: dev-foot / 2026-08-08
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out={};
// 1) package_sessions.deleted_at 컬럼 실재 + 정의
out.col = await q(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_sessions' AND column_name='deleted_at';`);
// 2) 최근 90일 status='used' + performed_by NOT NULL 차감건의 deleted_at 분포
out.dist = await q(`SELECT
    count(*) total,
    count(*) FILTER (WHERE deleted_at IS NULL) as deleted_null,
    count(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_set
  FROM package_sessions
  WHERE status='used' AND performed_by IS NOT NULL
    AND session_date >= (CURRENT_DATE - INTERVAL '90 days')::date;`);
// 3) clinic_id 조인까지 반영한 실제 렌더 대상 카운트 (packages.clinic_id 필터 동형)
out.render_scope = await q(`SELECT
    count(*) total,
    count(*) FILTER (WHERE ps.deleted_at IS NULL) as after_deleted_filter,
    sum(COALESCE(ps.unit_price,0) + COALESCE(ps.surcharge,0)) FILTER (WHERE ps.deleted_at IS NULL) as sum_amt_after
  FROM package_sessions ps
  JOIN packages p ON p.id = ps.package_id
  WHERE ps.status='used' AND ps.performed_by IS NOT NULL
    AND ps.session_date >= (CURRENT_DATE - INTERVAL '90 days')::date;`);
// 4) deleted_at 이 언제/왜 세팅되는지 — 표본 (NULL 아닌 것 몇 건, 값 분포)
out.sample_set = await q(`SELECT deleted_at, count(*) n
  FROM package_sessions WHERE status='used' AND deleted_at IS NOT NULL
  GROUP BY deleted_at ORDER BY n DESC LIMIT 5;`);
console.log(JSON.stringify(out,null,2));
