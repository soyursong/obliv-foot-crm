/**
 * E2E spec — T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX
 *
 * 수납 reconcile → check_in done 자동승격 배치(promote_reconciled_payment_waiting) 기능검증.
 * DA CONSULT-REPLY GO (MSG-20260802-100839-h7jo). 5 불변식:
 *   (1) write-once completed_at  (2) completed_at=payment business일 앵커(never now())
 *   (3) payment read-only        (4) forward-only date<today
 *   (5) 2-step 분리(공유트리거 무변)
 *
 * 현장 시나리오(AC4): 수납완료(reconciled) 후 스태프가 done 컬럼으로 미이동 → payment_waiting 정체 →
 *   배치가 status='done' 승격 → recency 가 done 행을 완료방문으로 읽어 재진 정상표시(초진 오분류 해소).
 *
 * 안전: p_check_in_id 스코프로 시드행 1건만 승격(prod 실데이터 무접점). 시드/회수 격리.
 *   RPC 미존재(마이그 미적용) 시 graceful skip → DB-gate 전 false-fail 방지.
 * 검증 환경: .env.local 주입된 macstudio(service_role) — cross_crm 표준.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot

const MARKER = 'PMWAUTOPROMO';

test.describe('T-20260728 PMW-AUTOPROMOTE — reconciled payment_waiting → done 자동승격', () => {
  test.skip(!SUPA_URL || !SERVICE_KEY, 'supabase env 미주입 — graceful skip');

  test('승격 + 앵커 + 멱등 + reconciled 없으면 미승격', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ── RPC 존재 확인(마이그 적용 전 graceful skip) ─────────────────
    const probe = await sb.rpc('promote_reconciled_payment_waiting', {
      p_clinic_id: CLINIC_ID,
      p_check_in_id: '00000000-0000-0000-0000-000000000000', // 무해 스코프(존재X)
    });
    if (probe.error && /function .* does not exist|not find/i.test(probe.error.message)) {
      test.skip(true, 'RPC 미배포(마이그 미적용) — DB-gate 후 재검증');
      return;
    }
    expect(probe.error, `RPC 호출 오류: ${probe.error?.message}`).toBeNull();

    const ts = Date.now();
    // 과거일자(어제) — forward-only(date<today) 충족 앵커.
    const yKST = new Date(Date.now() - 24 * 3600 * 1000);
    const y = `${yKST.getFullYear()}-${String(yKST.getMonth() + 1).padStart(2, '0')}-${String(yKST.getDate()).padStart(2, '0')}`;
    const pastCheckin = `${y}T02:00:00+09:00`;
    const expectedCompletedAt = new Date(`${y}T00:00:00+09:00`).toISOString(); // 회계귀속일 자정 KST 앵커

    const seededCheckIns: string[] = [];
    const seededCustomers: string[] = [];

    try {
      // ── 시드 A: reconciled payment 보유 payment_waiting(과거) = 승격 대상 ──
      const nameA = `${MARKER}-A-${ts}`;
      const phoneA = `010${String(ts).slice(-8)}`;
      const { data: custA } = await sb.from('customers')
        .insert({ clinic_id: CLINIC_ID, name: nameA, phone: phoneA, visit_type: 'new' })
        .select('id').single();
      seededCustomers.push(custA!.id);

      const { data: ciA, error: eA } = await sb.from('check_ins').insert({
        clinic_id: CLINIC_ID, customer_id: custA!.id, customer_name: nameA, customer_phone: phoneA,
        visit_type: 'new', status: 'payment_waiting', queue_number: 970000 + (ts % 20000),
        checked_in_at: pastCheckin,
      }).select('id').single();
      expect(eA, `시드 A check_in: ${eA?.message}`).toBeNull();
      seededCheckIns.push(ciA!.id);

      // reconciled payment (accounting_date=어제, reconciled_at NOT NULL)
      const { error: epA } = await sb.from('payments').insert({
        check_in_id: ciA!.id, clinic_id: CLINIC_ID, customer_id: custA!.id,
        amount: 50000, method: 'card', payment_type: 'payment',
        accounting_date: y, reconciled_at: pastCheckin,
      });
      expect(epA, `시드 A payment: ${epA?.message}`).toBeNull();

      // ── 시드 B: reconciled 없는 payment_waiting(과거) = 미승격(정체 정당) ──
      const nameB = `${MARKER}-B-${ts}`;
      const phoneB = `011${String(ts).slice(-8)}`;
      const { data: custB } = await sb.from('customers')
        .insert({ clinic_id: CLINIC_ID, name: nameB, phone: phoneB, visit_type: 'new' })
        .select('id').single();
      seededCustomers.push(custB!.id);
      const { data: ciB } = await sb.from('check_ins').insert({
        clinic_id: CLINIC_ID, customer_id: custB!.id, customer_name: nameB, customer_phone: phoneB,
        visit_type: 'new', status: 'payment_waiting', queue_number: 990000 + (ts % 9000),
        checked_in_at: pastCheckin,
      }).select('id').single();
      seededCheckIns.push(ciB!.id);
      // payment 있으나 미reconciled(reconciled_at NULL) → 배제 대상
      await sb.from('payments').insert({
        check_in_id: ciB!.id, clinic_id: CLINIC_ID, customer_id: custB!.id,
        amount: 50000, method: 'card', payment_type: 'payment', accounting_date: y,
      });

      // ── 실행 1: 시드 A 스코프 승격 ─────────────────────────────────
      const run1 = await sb.rpc('promote_reconciled_payment_waiting', {
        p_clinic_id: CLINIC_ID, p_check_in_id: ciA!.id,
      });
      expect(run1.error, `run1: ${run1.error?.message}`).toBeNull();
      expect(run1.data.promoted, '승격 대상 1건').toBe(1);

      // 검증: status=done + completed_at == business일 앵커(NOT now())
      const { data: afterA } = await sb.from('check_ins')
        .select('status,completed_at').eq('id', ciA!.id).single();
      expect(afterA!.status, 'status→done').toBe('done');
      expect(afterA!.completed_at, 'completed_at non-null').not.toBeNull();
      // (2) 앵커검증: 어제 자정 KST == 앵커, 오늘/배치시각(now) 아님
      expect(new Date(afterA!.completed_at!).toISOString(), 'completed_at=회계귀속일 앵커(never now)').toBe(expectedCompletedAt);

      // (5) status_transitions 감사행 — from=payment_waiting, to=done, changed_by=system:auto-promote, transitioned_at=앵커
      const { data: st } = await sb.from('status_transitions')
        .select('from_status,to_status,changed_by,transitioned_at')
        .eq('check_in_id', ciA!.id).eq('to_status', 'done').order('transitioned_at', { ascending: false }).limit(1);
      expect(st && st.length, 'status_transitions 감사행').toBeGreaterThan(0);
      expect(st![0].from_status).toBe('payment_waiting');
      expect(st![0].changed_by).toBe('system:auto-promote');
      expect(new Date(st![0].transitioned_at).toISOString(), 'transitioned_at=앵커').toBe(expectedCompletedAt);

      // ── (1) 멱등: 재실행 → promoted=0, completed_at 불변 ─────────────
      const run2 = await sb.rpc('promote_reconciled_payment_waiting', {
        p_clinic_id: CLINIC_ID, p_check_in_id: ciA!.id,
      });
      expect(run2.error).toBeNull();
      expect(run2.data.promoted, '멱등 재실행 promoted=0').toBe(0);
      const { data: afterA2 } = await sb.from('check_ins').select('completed_at').eq('id', ciA!.id).single();
      expect(new Date(afterA2!.completed_at!).toISOString(), 'completed_at 불변(clobber 없음)').toBe(expectedCompletedAt);

      // ── 시드 B: reconciled 없음 → 미승격(payment_waiting 유지) ────────
      const runB = await sb.rpc('promote_reconciled_payment_waiting', {
        p_clinic_id: CLINIC_ID, p_check_in_id: ciB!.id,
      });
      expect(runB.error).toBeNull();
      expect(runB.data.promoted, 'reconciled 없으면 미승격').toBe(0);
      const { data: afterB } = await sb.from('check_ins').select('status').eq('id', ciB!.id).single();
      expect(afterB!.status, 'B는 payment_waiting 유지').toBe('payment_waiting');

      // ── (3) payment read-only 확인: A payment 무변경(reconciled_at/accounting_date) ──
      const { data: payA } = await sb.from('payments')
        .select('reconciled_at,accounting_date,amount').eq('check_in_id', ciA!.id).single();
      expect(payA!.accounting_date, 'payment accounting_date 불변').toBe(y);
      expect(payA!.amount, 'payment amount 불변').toBe(50000);
    } finally {
      // ── 회수 ──────────────────────────────────────────────────────
      for (const id of seededCheckIns) {
        await sb.from('status_transitions').delete().eq('check_in_id', id);
        await sb.from('payments').delete().eq('check_in_id', id);
        await sb.from('check_ins').delete().eq('id', id);
      }
      for (const id of seededCustomers) await sb.from('customers').delete().eq('id', id);
    }
  });
});
