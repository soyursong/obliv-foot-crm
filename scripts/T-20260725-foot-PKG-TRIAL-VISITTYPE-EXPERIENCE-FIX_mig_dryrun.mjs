/**
 * T-20260725-foot-PKG-TRIAL-VISITTYPE-EXPERIENCE-FIX — MIG-GATE dry-run (shadow, no-persistence)
 * 전략: 신규 exp_agg 정의를 임시함수명 __dryrun 으로 shadow 생성 → July/June 실측 비교 → DROP(자기정리).
 *   LIVE foot_stats_therapist_summary 무접촉. 대상 오브젝트 사후부재(post-probe) 확인 포함.
 * author: dev-foot / 2026-07-25
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no token'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// 신규 함수 본문(migration 20260725190000 의 exp_agg 확장) — 임시명으로 shadow.
const DRYRUN_FN = `
CREATE OR REPLACE FUNCTION foot_stats_therapist_summary__dryrun(
  p_clinic_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (therapist_id UUID, name TEXT, treatment_count INT, avg_treatment_minutes NUMERIC,
  experience_total INT, experience_converted INT, conversion_rate NUMERIC,
  designated_count INT, total_checkin_count INT, designated_rate NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH
  roster AS (SELECT s.id AS therapist_id, s.name FROM staff s
    WHERE s.clinic_id = p_clinic_id AND s.role='therapist' AND s.active=true),
  base AS (SELECT ci.id, ci.therapist_id, ci.customer_id, ci.visit_type, ci.package_id,
      (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM check_ins ci JOIN roster r ON r.therapist_id = ci.therapist_id
    WHERE ci.clinic_id = p_clinic_id AND ci.therapist_id IS NOT NULL AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to),
  exp_agg AS (
    SELECT b.therapist_id, COUNT(*)::int AS exp_total,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM package_payments pp
        WHERE pp.package_id = b.package_id AND pp.payment_type='payment'))::int AS exp_conv
    FROM base b
    WHERE b.visit_type='experience'
       OR EXISTS (SELECT 1 FROM package_sessions ps
            WHERE ps.check_in_id = b.id AND ps.session_type='trial' AND ps.status='used')
    GROUP BY b.therapist_id)
  SELECT r.therapist_id, r.name, 0, NULL::numeric,
    COALESCE(e.exp_total,0), COALESCE(e.exp_conv,0),
    CASE WHEN COALESCE(e.exp_total,0)>0 THEN ROUND(e.exp_conv::numeric/e.exp_total*100,1) END,
    0, 0, NULL::numeric
  FROM roster r LEFT JOIN exp_agg e ON e.therapist_id = r.therapist_id
  ORDER BY r.name;
$$;`;

const out = {};
try {
  const clinic = await q(`SELECT id, slug, name FROM clinics WHERE slug='jongno-foot';`);
  out.clinic = clinic;
  const cid = clinic[0].id;

  // G1: shadow 생성 (compile 성공 = 문법·의존 OK)
  await q(DRYRUN_FN);
  out.shadow_created = true;

  // July: LIVE vs NEW experience_total 비교
  out.july_live = await q(`SELECT name, experience_total, experience_converted, conversion_rate FROM foot_stats_therapist_summary('${cid}','2026-07-01','2026-07-31') WHERE experience_total>0 ORDER BY name;`);
  out.july_new  = await q(`SELECT name, experience_total, experience_converted, conversion_rate FROM foot_stats_therapist_summary__dryrun('${cid}','2026-07-01','2026-07-31') WHERE experience_total>0 ORDER BY name;`);
  out.july_live_sum = await q(`SELECT COALESCE(SUM(experience_total),0) s FROM foot_stats_therapist_summary('${cid}','2026-07-01','2026-07-31');`);
  out.july_new_sum  = await q(`SELECT COALESCE(SUM(experience_total),0) s FROM foot_stats_therapist_summary__dryrun('${cid}','2026-07-01','2026-07-31');`);

  // June: 회귀검증 — 기존 experience(6/27 1건) 불변 확인
  out.june_live_sum = await q(`SELECT COALESCE(SUM(experience_total),0) s FROM foot_stats_therapist_summary('${cid}','2026-06-01','2026-06-30');`);
  out.june_new_sum  = await q(`SELECT COALESCE(SUM(experience_total),0) s FROM foot_stats_therapist_summary__dryrun('${cid}','2026-06-01','2026-06-30');`);
} finally {
  // post-probe cleanup: 임시함수 DROP + 부재 확인 (no-persistence)
  try { await q(`DROP FUNCTION IF EXISTS foot_stats_therapist_summary__dryrun(UUID,DATE,DATE);`); } catch (e) { out.drop_err = String(e); }
  out.postprobe_absent = await q(`SELECT count(*) n FROM pg_proc WHERE proname='foot_stats_therapist_summary__dryrun';`);
}
console.log(JSON.stringify(out, null, 2));
