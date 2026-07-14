/**
 * T-20260714-foot-DAILYCLOSE-MISU-NOSYNC — 감사추적 ADDITIVE 재구성 (DA Q1=C 정직수렴)
 *
 * ★ READ-ONLY (SELECT/introspection only). prod 금융 write 절대 금지.
 *   F-4695 · pkg e55c868d · cmp d993ffc5 특정 write = 영구 freeze.
 *   본 스크립트는 UPDATE/INSERT/DELETE/DDL 0건. Management API database/query = SELECT 전용.
 *
 * 목적 (DA-20260714-DAILYCLOSE-MISU-METHOD-DIVERGENCE §41 C-2 (a)):
 *   현 prod fresh 스냅샷을 채취해 SSOT 문서에 append.
 *   1) pkg e55c868d total/paid/balance(=0)
 *   2) package_payments 신규행(opt-A 정본화) full row
 *   3) closing_manual_payments d993ffc5 부재 확인
 *   4) 2026-07-14 close 3버킷 총계 (payments / package_payments / closing_manual_payments)
 *      — Closing.tsx 산식 그대로 (KST day bounds, clinic 필터, NET/GROSS, membership 제외)
 *
 * 실행: node scripts/T-20260714-foot-DAILYCLOSE-MISU-NOSYNC_snapshot.mjs
 * author: dev-foot / 2026-07-14
 */
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

// ── SELECT-only guard: 위험 키워드 차단 (read-only 계약 강제) ──────────────
async function q(sql) {
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/i;
  if (forbidden.test(sql)) { console.error('ABORT: non-SELECT keyword detected — read-only violation'); process.exit(1); }
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const PKG = 'e55c868d-7b39-4b50-a98e-305d2353152d';
const MANUAL = 'd993ffc5-8c9b-4ef8-a1cf-df73b51aaba5';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CLOSE_DATE = '2026-07-14';
const START = `${CLOSE_DATE}T00:00:00+09:00`;
const END = `${CLOSE_DATE}T23:59:59+09:00`;
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const out = {};

// ── 1) pkg e55c868d total/paid/balance ─────────────────────────────────
out.package = await q(`
  SELECT id, customer_id, package_name, status, total_amount, consultation_fee,
         paid_amount, total_sessions, created_at
  FROM public.packages WHERE id = '${PKG}';`);

// pkg balance = total_amount - NET(package_payments, fee_kind=package)
out.package_balance = await q(`
  SELECT
    p.total_amount,
    p.paid_amount,
    COALESCE(SUM(CASE WHEN COALESCE(pp.fee_kind,'package')='package'
                      THEN (CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
                      ELSE 0 END), 0)                                   AS net_pkg_payments,
    p.total_amount
      - COALESCE(SUM(CASE WHEN COALESCE(pp.fee_kind,'package')='package'
                          THEN (CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
                          ELSE 0 END), 0)                               AS balance
  FROM public.packages p
  LEFT JOIN public.package_payments pp ON pp.package_id = p.id
  WHERE p.id = '${PKG}'
  GROUP BY p.total_amount, p.paid_amount;`);

// ── 2) package_payments 신규행 (opt-A 정본화) full row — 전 컬럼 ─────────
out.package_payments_full = await q(`
  SELECT * FROM public.package_payments
  WHERE package_id = '${PKG}'
  ORDER BY created_at ASC;`);

// ── 3) closing_manual_payments d993ffc5 부재 확인 ───────────────────────
out.manual_by_id = await q(`
  SELECT id FROM public.closing_manual_payments WHERE id = '${MANUAL}';`);
out.manual_by_id_count = await q(`
  SELECT COUNT(*)::int AS cnt FROM public.closing_manual_payments WHERE id = '${MANUAL}';`);
// F-4695 / 이미현 관련 잔존 수기행 전수 확인 (부재의 폭 검증)
out.manual_f4695_any = await q(`
  SELECT id, close_date, chart_number, customer_name, amount, method, memo, created_at
  FROM public.closing_manual_payments
  WHERE chart_number = 'F-4695' OR customer_name = '이미현';`);

// ── 4) 2026-07-14 close 3버킷 총계 (Closing.tsx 산식 재현) ────────────────
// 버킷1: 단건 결제 payments — clinic + created_at + status!='deleted'
out.bucket_single = await q(`
  SELECT method,
         COUNT(*) FILTER (WHERE payment_type<>'refund')::int                        AS gross_cnt,
         COUNT(*) FILTER (WHERE payment_type='refund')::int                         AS refund_cnt,
         COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net_amt,
         COALESCE(SUM(amount) FILTER (WHERE payment_type<>'refund'),0)              AS gross_amt
  FROM public.payments
  WHERE clinic_id='${CLINIC}' AND created_at>='${START}' AND created_at<='${END}'
    AND status IS DISTINCT FROM 'deleted'
  GROUP BY method ORDER BY method;`);

// 버킷2: 패키지 결제 package_payments — clinic + created_at (status 필터 없음)
out.bucket_pkg = await q(`
  SELECT method,
         COUNT(*) FILTER (WHERE payment_type<>'refund')::int                        AS gross_cnt,
         COUNT(*) FILTER (WHERE payment_type='refund')::int                         AS refund_cnt,
         COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net_amt,
         COALESCE(SUM(amount) FILTER (WHERE payment_type<>'refund'),0)              AS gross_amt
  FROM public.package_payments
  WHERE clinic_id='${CLINIC}' AND created_at>='${START}' AND created_at<='${END}'
  GROUP BY method ORDER BY method;`);

// 버킷3: 수기 결제 closing_manual_payments — clinic + close_date (항상 payment)
out.bucket_manual = await q(`
  SELECT method, COUNT(*)::int AS cnt, COALESCE(SUM(amount),0) AS amt
  FROM public.closing_manual_payments
  WHERE clinic_id='${CLINIC}' AND close_date='${CLOSE_DATE}'
  GROUP BY method ORDER BY method;`);

// grossTotal (NET, membership 제외 = card/cash/transfer만) — 3버킷 합
out.gross_total = await q(`
  WITH s AS (
    SELECT method, SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END) AS amt
    FROM public.payments
    WHERE clinic_id='${CLINIC}' AND created_at>='${START}' AND created_at<='${END}'
      AND status IS DISTINCT FROM 'deleted' GROUP BY method
    UNION ALL
    SELECT method, SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END) AS amt
    FROM public.package_payments
    WHERE clinic_id='${CLINIC}' AND created_at>='${START}' AND created_at<='${END}' GROUP BY method
    UNION ALL
    SELECT method, SUM(amount) AS amt
    FROM public.closing_manual_payments
    WHERE clinic_id='${CLINIC}' AND close_date='${CLOSE_DATE}' GROUP BY method
  )
  SELECT
    COALESCE(SUM(amt) FILTER (WHERE method='card'),0)     AS total_card,
    COALESCE(SUM(amt) FILTER (WHERE method='cash'),0)     AS total_cash,
    COALESCE(SUM(amt) FILTER (WHERE method='transfer'),0) AS total_transfer,
    COALESCE(SUM(amt) FILTER (WHERE method IN ('card','cash','transfer')),0) AS gross_total
  FROM s;`);

// daily_closings 확정 여부 (2026-07-14 마감 상태)
out.daily_closing = await q(`
  SELECT * FROM public.daily_closings
  WHERE clinic_id='${CLINIC}' AND close_date='${CLOSE_DATE}';`);

console.log('===== T-20260714-foot-DAILYCLOSE-MISU-NOSYNC fresh snapshot (READ-ONLY) =====');
console.log('snapshot_at:', new Date().toISOString());
console.log(JSON.stringify(out, null, 2));

// ── 요약 라인 ───────────────────────────────────────────────────────────
const pk = out.package_balance?.[0];
console.log('\n--- SUMMARY ---');
if (pk) console.log(`pkg ${PKG}: total=${won(pk.total_amount)} paid=${won(pk.paid_amount)} netPkgPay=${won(pk.net_pkg_payments)} balance=${won(pk.balance)}`);
console.log(`pkg payments rows: ${out.package_payments_full?.length ?? 0}`);
console.log(`manual d993ffc5 존재? ${(out.manual_by_id_count?.[0]?.cnt ?? 0) === 0 ? '부재 ✅ (0행)' : '⚠ 존재'}`);
const g = out.gross_total?.[0];
if (g) console.log(`close 3버킷 grossTotal(NET, membership제외)=${won(g.gross_total)} (card=${won(g.total_card)} cash=${won(g.total_cash)} transfer=${won(g.total_transfer)})`);
console.log(`daily_closing 2026-07-14: ${out.daily_closing?.length ? (out.daily_closing[0].status ?? JSON.stringify(out.daily_closing[0])) : '레코드 없음(미확정)'}`);
