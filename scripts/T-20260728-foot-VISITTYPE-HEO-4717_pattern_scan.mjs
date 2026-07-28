import { query as q } from './lib/foot_migration_ledger.mjs';
const FOOT='74967aea-a60b-4da3-a0e7-9c997a930bc8';
// Q-A: payment_waiting 정체 check_ins (deleted 아님, 오늘KST자정 이전) — 진료동선 흔적(therapist/consultant 배정)
console.log('=== Q-A: 정체된 payment_waiting check_ins (< 오늘자정, 배정흔적 有) ===');
console.table((await q(`
  SELECT ci.id, ci.customer_name, ci.visit_type, ci.checked_in_at,
         (ci.therapist_id IS NOT NULL OR ci.consultant_id IS NOT NULL) AS has_assign
  FROM public.check_ins ci
  WHERE ci.clinic_id='${FOOT}' AND ci.status='payment_waiting' AND ci.deleted_at IS NULL
    AND ci.checked_in_at < (now() AT TIME ZONE 'Asia/Seoul')::date::timestamptz
  ORDER BY ci.checked_in_at;`)));
// Q-B: orphan payments (check_in_id NULL, active) — 연결 끊긴 수납
console.log('=== Q-B: orphan payments (check_in_id NULL, status active, deleted 아님) count ===');
console.table((await q(`
  SELECT count(*) AS orphan_cnt, min(accounting_date) AS oldest, max(accounting_date) AS newest
  FROM public.payments
  WHERE clinic_id='${FOOT}' AND check_in_id IS NULL AND status='active' AND deleted_at IS NULL;`)));
// Q-C: 정확한 현은호 패턴 — orphan payment 고객이 같은 accounting_date에 payment_waiting check_in 보유
console.log('=== Q-C: orphan-payment ∩ same-day payment_waiting check_in (현은호 패턴 정확 일치) ===');
console.table((await q(`
  SELECT p.customer_id, p.id AS payment_id, p.amount, p.accounting_date, p.created_at AS pay_created,
         ci.id AS check_in_id, ci.customer_name, ci.status AS ci_status, ci.checked_in_at
  FROM public.payments p
  JOIN public.check_ins ci
    ON ci.customer_id = p.customer_id
   AND ci.clinic_id = p.clinic_id
   AND ci.status='payment_waiting' AND ci.deleted_at IS NULL
   AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date = p.accounting_date
  WHERE p.clinic_id='${FOOT}' AND p.check_in_id IS NULL AND p.status='active' AND p.deleted_at IS NULL
  ORDER BY p.accounting_date;`)));
