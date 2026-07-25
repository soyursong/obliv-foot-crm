/**
 * T-20260725-foot-PKG-TRIAL-VISITTYPE-EXPERIENCE-FIX — PROD 증거기반 probe (READ-ONLY)
 * 목적(ticket step1): 패키지 체험권(session_type='trial') 차감으로 링크된 check_ins의 현재 visit_type 저장값 확인
 *   + Option B(집계단) 적용 시 실제로 잡히는 대상 수 사전 실측(therapist_id/status/cancel 요건 충족 여부).
 * READ-ONLY. author: dev-foot / 2026-07-25
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
const out = {};
// 1) trial 세션 총량 + status 분포
out.trial_sessions_total = await q(
  `SELECT status, count(*) n, count(check_in_id) linked FROM package_sessions WHERE session_type='trial' GROUP BY status ORDER BY n DESC;`);
// 2) trial(used)로 링크된 check_ins 의 현재 visit_type 분포 (핵심: experience 로 저장되는지)
out.trial_linked_checkin_visittype = await q(
  `SELECT ci.visit_type, count(*) n, count(ci.therapist_id) with_therapist, count(*) FILTER (WHERE ci.status='cancelled') cancelled
   FROM package_sessions ps JOIN check_ins ci ON ci.id = ps.check_in_id
   WHERE ps.session_type='trial' AND ps.status='used' GROUP BY ci.visit_type ORDER BY n DESC;`);
// 3) Option B 로 실제 신규 카운트될 대상(현재 visit_type != experience 인데 trial-link 됨) — roster/status 요건 포함
out.optB_newly_counted = await q(
  `SELECT count(DISTINCT ci.id) n
   FROM package_sessions ps
   JOIN check_ins ci ON ci.id = ps.check_in_id
   JOIN staff s ON s.id = ci.therapist_id AND s.role='therapist' AND s.active=true
   WHERE ps.session_type='trial' AND ps.status='used'
     AND ci.visit_type <> 'experience' AND ci.status <> 'cancelled';`);
// 4) 현재 experience 총량(대조군) + check_ins.visit_type 전체 분포
out.checkin_visittype_dist = await q(
  `SELECT visit_type, count(*) n FROM check_ins GROUP BY visit_type ORDER BY n DESC;`);
// 5) trial-linked check_ins 의 월별(KST) 분포 — 소급 규모 파악
out.trial_linked_by_month = await q(
  `SELECT to_char((ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date,'YYYY-MM') ym, count(DISTINCT ci.id) n
   FROM package_sessions ps JOIN check_ins ci ON ci.id = ps.check_in_id
   WHERE ps.session_type='trial' AND ps.status='used'
   GROUP BY 1 ORDER BY 1;`);
console.log(JSON.stringify(out, null, 2));
