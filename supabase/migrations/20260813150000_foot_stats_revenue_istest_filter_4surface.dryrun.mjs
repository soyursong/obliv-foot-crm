/**
 * T-20260813-foot-STATS-REVENUE-ISTEST-FILTER-4SURFACE — no-persistence dry-run
 *
 * (A) 파싱/유효성: 마이그 4 CREATE OR REPLACE 를 BEGIN…ROLLBACK 로 감싸 실행 → 에러0=유효, ROLLBACK=무영속.
 * (B) 델타 정합: 각 surface 신규 body 를 inline SELECT(READ-ONLY)로 실행, 현행 live 대비 델타 산출.
 * (C) 무영속 증명: 실행 후 live pg_get_viewdef/functiondef 재조회 → 여전히 is_test 미포함 확인.
 *
 * ★prod write 0. CREATE 는 txn 내부 ROLLBACK 으로 폐기. GO-token 前 apply 금지 준수.
 */
import { readFileSync } from 'node:fs';
const R = 'rxlomoozakkjesdqjtvd';
const T = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN required'); })();
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${R}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  return { ok: r.ok, status: r.status, body: b };
};
const line = (s = '') => console.log(s);
const H = (s) => { line(); line('━'.repeat(60)); line(s); line('━'.repeat(60)); };
line(`# dry-run (no-persistence)  ${new Date().toISOString()}`);

// migration body (strip its own BEGIN/COMMIT/NOTIFY → wrap in our BEGIN…ROLLBACK)
const raw = readFileSync(new URL('./20260813150000_foot_stats_revenue_istest_filter_4surface.sql', import.meta.url), 'utf8');
const body = raw
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT|NOTIFY)\b/i.test(l)).join('\n');

// ── (A) 파싱/유효성 + 무영속 ──
H('(A) 파싱/유효성 (BEGIN…ROLLBACK · 무영속)');
const a = await sql(`BEGIN;\n${body}\nROLLBACK;`);
if (!a.ok) { line('  ✗ FAIL: ' + JSON.stringify(a.body)); process.exit(1); }
line('  ✓ PASS — 4 CREATE OR REPLACE 파싱·실행 성공, ROLLBACK 으로 무영속.');

// ── (B) 델타 정합 (inline new-body SELECT vs live) ──
H('(B) 델타 정합 (신규 body inline SELECT vs 현행 live)');

// #2 v_daily_avg_spend
const avgNew = `
 WITH single AS (SELECT (payments.created_at AT TIME ZONE 'Asia/Seoul')::date dt, payments.clinic_id,
    sum(CASE WHEN payments.payment_type='refund' THEN -payments.amount ELSE payments.amount END) amt, count(*)::int cnt
   FROM payments LEFT JOIN customers cu ON cu.id=payments.customer_id
   WHERE payments.clinic_id IS NOT NULL AND NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)
   GROUP BY 1,2),
 pkg AS (SELECT (package_payments.created_at AT TIME ZONE 'Asia/Seoul')::date dt, package_payments.clinic_id,
    sum(CASE WHEN package_payments.payment_type='refund' THEN -package_payments.amount ELSE package_payments.amount END) amt, count(*)::int cnt
   FROM package_payments LEFT JOIN customers cu ON cu.id=package_payments.customer_id
   WHERE package_payments.clinic_id IS NOT NULL AND NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)
   GROUP BY 1,2)
 SELECT COALESCE(s.amt,0)+COALESCE(p.amt,0) net_revenue, COALESCE(s.cnt,0)+COALESCE(p.cnt,0) paid_count
   FROM single s FULL JOIN pkg p ON p.dt=s.dt AND p.clinic_id=s.clinic_id`;
const r2 = await sql(`
  SELECT
    (SELECT COALESCE(SUM(net_revenue),0) FROM v_daily_avg_spend)              AS live_net,
    (SELECT COALESCE(SUM(paid_count),0)  FROM v_daily_avg_spend)              AS live_cnt,
    (SELECT COALESCE(SUM(net_revenue),0) FROM (${avgNew}) x)                  AS new_net,
    (SELECT COALESCE(SUM(paid_count),0)  FROM (${avgNew}) x)                  AS new_cnt`);
line('  #2 v_daily_avg_spend: ' + JSON.stringify(r2.body[0]));

// #3 v_monthly_therapist_perf — compare total net_revenue (check_ins.customer_id 필터)
const therNew = readInlineTherapist();
const r3l = await sql(`SELECT COALESCE(SUM(net_revenue),0) live_net, COALESCE(SUM(procedure_count),0) live_cnt FROM v_monthly_therapist_perf`);
const r3n = await sql(`SELECT COALESCE(SUM(net_revenue),0) new_net, COALESCE(SUM(procedure_count),0) new_cnt FROM (${therNew}) x`);
line('  #3 v_monthly_therapist_perf: ' + JSON.stringify({ ...r3l.body[0], ...r3n.body[0] }));

// #4 v_monthly_consultant_perf
const consNew = readInlineConsultant();
const r4l = await sql(`SELECT COALESCE(SUM(net_revenue),0) live_net, COALESCE(SUM(consult_count),0) live_cnt FROM v_monthly_consultant_perf`);
const r4n = await sql(`SELECT COALESCE(SUM(net_revenue),0) new_net, COALESCE(SUM(consult_count),0) new_cnt FROM (${consNew}) x`);
line('  #4 v_monthly_consultant_perf: ' + JSON.stringify({ ...r4l.body[0], ...r4n.body[0] }));

// #1 foot_stats_revenue RPC — inline new single/pkg pay·ref, live(sim만) vs new(sim+test)
for (const [tbl, st] of [['payments', "AND status NOT IN ('cancelled','deleted')"], ['package_payments', '']]) {
  const q = (test) => `SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0) pay, COALESCE(SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END),0) ref FROM ${tbl} WHERE clinic_id IS NOT NULL ${st} AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=${tbl}.customer_id AND (c.is_simulation IS TRUE ${test ? 'OR c.is_test IS TRUE' : ''}))`;
  const live = await sql(q(false)), nw = await sql(q(true));
  line(`  #1 foot_stats_revenue ${tbl}: live ${JSON.stringify(live.body[0])} → new ${JSON.stringify(nw.body[0])}`);
}

// ── (C) 무영속 증명 ──
H('(C) 무영속 증명 (live def 여전히 is_test 미포함)');
for (const v of ['v_daily_avg_spend','v_monthly_therapist_perf','v_monthly_consultant_perf']) {
  const d = await sql(`SELECT pg_get_viewdef('public.${v}'::regclass,true) def`);
  const hasIsTest = /is_test/i.test(d.body[0].def);
  line(`  ${v}: is_test in live def = ${hasIsTest}  ${hasIsTest?'✗(persisted!)':'✓(unchanged)'}`);
}
const fd = await sql(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_revenue'`);
const fnHas = /is_test/i.test(fd.body[0].def);
line(`  foot_stats_revenue: is_test in live def = ${fnHas}  ${fnHas?'✗(persisted!)':'✓(unchanged)'}`);

line();
line('# dry-run done.');

// ── helpers: inline new bodies for #3/#4 ──
function readInlineTherapist() {
  return `
 WITH ci_staff AS (
   SELECT ci.id, ci.clinic_id, ci.checked_in_at, ci.completed_at, ci.therapist_id staff_id, 'therapist' staff_role
     FROM check_ins ci LEFT JOIN customers cu ON cu.id=ci.customer_id
    WHERE ci.therapist_id IS NOT NULL AND ci.status='done' AND NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)
   UNION ALL
   SELECT ci.id, ci.clinic_id, ci.checked_in_at, ci.completed_at, ci.technician_id staff_id, 'technician' staff_role
     FROM check_ins ci LEFT JOIN customers cu ON cu.id=ci.customer_id
    WHERE ci.technician_id IS NOT NULL AND ci.status='done' AND NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)),
 revenue AS (SELECT cs.staff_id, cs.clinic_id, date_trunc('month',(cs.checked_in_at AT TIME ZONE 'Asia/Seoul'))::date AS month,
    sum(COALESCE(p.amount_signed,0))::bigint rev
   FROM ci_staff cs LEFT JOIN LATERAL (SELECT sum(CASE WHEN payments.payment_type='refund' THEN -payments.amount ELSE payments.amount END) amount_signed FROM payments WHERE payments.check_in_id=cs.id) p ON true
   GROUP BY 1,2,3),
 counts AS (SELECT cs.staff_id, cs.clinic_id, date_trunc('month',(cs.checked_in_at AT TIME ZONE 'Asia/Seoul'))::date AS month, count(*)::int procedure_count
   FROM ci_staff cs WHERE cs.completed_at IS NOT NULL AND cs.completed_at>cs.checked_in_at GROUP BY 1,2,3)
 SELECT c.procedure_count, COALESCE(r.rev,0) net_revenue
   FROM counts c LEFT JOIN revenue r ON r.staff_id=c.staff_id AND r.clinic_id=c.clinic_id AND r.month=c.month`;
}
function readInlineConsultant() {
  return `
 WITH ci AS (SELECT check_ins.id, check_ins.clinic_id, check_ins.consultant_id, date_trunc('month',(check_ins.checked_in_at AT TIME ZONE 'Asia/Seoul'))::date AS month
   FROM check_ins LEFT JOIN customers cu ON cu.id=check_ins.customer_id
   WHERE check_ins.consultant_id IS NOT NULL AND check_ins.status='done' AND NOT COALESCE(cu.is_test,false) AND NOT COALESCE(cu.is_simulation,false)),
 revenue AS (SELECT ci.consultant_id, ci.clinic_id, ci.month, sum(COALESCE(p.amount_signed,0))::bigint rev
   FROM ci LEFT JOIN LATERAL (SELECT sum(CASE WHEN payments.payment_type='refund' THEN -payments.amount ELSE payments.amount END) amount_signed FROM payments WHERE payments.check_in_id=ci.id) p ON true
   GROUP BY 1,2,3),
 counts AS (SELECT ci.consultant_id, ci.clinic_id, ci.month, count(*)::int consult_count FROM ci GROUP BY 1,2,3)
 SELECT c.consult_count, COALESCE(r.rev,0) net_revenue
   FROM counts c LEFT JOIN revenue r ON r.consultant_id=c.consultant_id AND r.clinic_id=c.clinic_id AND r.month=c.month`;
}
