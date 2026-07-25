/**
 * T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET — MIG-GATE dry-run (shadow, no-persistence)
 * 전략: 신규 exp_conv(전환 분자) 정의를 임시함수명 __dryrun2 로 shadow 생성 → LIVE 대비 July/June 실측 비교
 *   → DROP(자기정리) + 사후부재(post-probe) 확인. LIVE foot_stats_therapist_summary 무접촉.
 * 검증: (1) experience_total 무회귀(=LIVE) (2) experience_converted 전/후 delta (3) conversion_rate.
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

// 신규 exp_conv(전환 분자) 정의 — migration 20260725200000 의 exp_agg 를 임시명으로 shadow.
const DRYRUN_FN = `
CREATE OR REPLACE FUNCTION foot_stats_therapist_summary__dryrun2(
  p_clinic_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (therapist_id UUID, name TEXT, experience_total INT, experience_converted INT, conversion_rate NUMERIC)
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
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM packages pk
        WHERE pk.clinic_id = p_clinic_id AND pk.customer_id = b.customer_id
          AND pk.contract_date = b.kst_date
          AND pk.status NOT IN ('cancelled','refunded')
          AND pk.total_sessions >= 2
          AND COALESCE(pk.package_type,'') NOT ILIKE '%체험%'
          AND COALESCE(pk.treatment_type,'') <> '체험권'
          AND pk.package_type NOT IN ('template','preset_12')
          AND pk.transferred_from IS NULL))::int AS exp_conv
    FROM base b
    WHERE b.visit_type='experience'
       OR EXISTS (SELECT 1 FROM package_sessions ps
            WHERE ps.check_in_id = b.id AND ps.session_type='trial' AND ps.status='used')
    GROUP BY b.therapist_id)
  SELECT r.therapist_id, r.name, COALESCE(e.exp_total,0), COALESCE(e.exp_conv,0),
    CASE WHEN COALESCE(e.exp_total,0)>0 THEN ROUND(e.exp_conv::numeric/e.exp_total*100,1) END
  FROM roster r LEFT JOIN exp_agg e ON e.therapist_id = r.therapist_id
  ORDER BY r.name;
$$;`;

const out = { generated_by: 'dev-foot', ticket: 'T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET' };
try {
  const clinic = await q(`SELECT id, slug FROM clinics WHERE slug='jongno-foot';`);
  const cid = clinic[0].id;
  out.clinic_id = cid;

  await q(DRYRUN_FN);

  for (const [label, F, T] of [['2026-07', '2026-07-01', '2026-07-31'], ['2026-06', '2026-06-01', '2026-06-30']]) {
    const live = await q(`SELECT COALESCE(SUM(experience_total),0) exp_total, COALESCE(SUM(experience_converted),0) exp_conv
      FROM foot_stats_therapist_summary('${cid}','${F}','${T}');`);
    const dry = await q(`SELECT COALESCE(SUM(experience_total),0) exp_total, COALESCE(SUM(experience_converted),0) exp_conv
      FROM foot_stats_therapist_summary__dryrun2('${cid}','${F}','${T}');`);
    out[label] = {
      LIVE: live[0], NEW: dry[0],
      exp_total_regress: Number(live[0].exp_total) !== Number(dry[0].exp_total),
      exp_conv_delta: Number(dry[0].exp_conv) - Number(live[0].exp_conv),
    };
  }

  // self-cleanup + post-probe (무영속 확인)
  await q(`DROP FUNCTION IF EXISTS foot_stats_therapist_summary__dryrun2(UUID, DATE, DATE);`);
  const post = await q(`SELECT count(*)::int AS still_present FROM pg_proc WHERE proname='foot_stats_therapist_summary__dryrun2';`);
  out.post_probe_shadow_dropped = post[0].still_present === 0;

  // 판정
  const regress = ['2026-07', '2026-06'].some(m => out[m].exp_total_regress);
  out.VERDICT = {
    experience_total_no_regression: !regress,
    conversion_delta_2026_07: out['2026-07'].exp_conv_delta,
    conversion_delta_2026_06: out['2026-06'].exp_conv_delta,
    shadow_cleaned: out.post_probe_shadow_dropped,
    pass: !regress && out.post_probe_shadow_dropped,
  };
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('DRYRUN FAIL:', e.message);
  try { await q(`DROP FUNCTION IF EXISTS foot_stats_therapist_summary__dryrun2(UUID, DATE, DATE);`); } catch {}
  process.exit(1);
}
