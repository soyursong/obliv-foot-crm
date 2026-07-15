/**
 * T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK
 * 패키지 재생성 credit 고아화(F-4716) 구조 lane DB 계약 검증.
 *
 * DA CONSULT-REPLY(§10-5 적용) 처방 4구조가 dev DB 에 정확히 착지했는지 + 불변식 검증:
 *   (1) payments.package_id FK — ON DELETE RESTRICT (credit fail-closed)
 *   (2) packages.superseded_by — 재생성 계보 링크
 *   (3) package_credit_ledger — append-only, balance=Σamount 파생(§10-5)
 *   (4) package_amendments — audit child
 *
 * ⚠ 마이그레이션 미적용 DB 에서는 graceful skip(기존 spec 패턴). supervisor DDL-diff 적용 후 GREEN.
 * service_role 로 스키마 계약을 검증(RLS 우회) — append-only RLS 자체는 supervisor 게이트 post-deploy 체크에서.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('PKG-REGEN-CREDIT-ORPHAN-FKLINK — 구조 DB 계약', () => {
  test('구조 4객체 착지 + 불변식(FK RESTRICT / balance 파생 / append-only 앵커)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // ── 선행: 마이그 적용 여부 프로브(미적용이면 skip) ──
    const ledgerProbe = await sb.from('package_credit_ledger').select('id').limit(0);
    if (ledgerProbe.error) {
      test.skip(true, `마이그 미적용(package_credit_ledger 없음): ${ledgerProbe.error.message}`);
    }

    // (2) packages.superseded_by 컬럼 존재
    const supProbe = await sb.from('packages').select('id, superseded_by').limit(0);
    expect(supProbe.error, 'packages.superseded_by 컬럼 존재').toBeNull();

    // (1) payments.package_id 컬럼 존재
    const payProbe = await sb.from('payments').select('id, package_id').limit(0);
    expect(payProbe.error, 'payments.package_id 컬럼 존재').toBeNull();

    // ── 시드: 고객 + 패키지 ──
    const { data: cust } = await sb.from('customers')
      .insert({ clinic_id: CLINIC_ID, name: 'qa-fklink', phone: '01098580777', visit_type: 'new' })
      .select().single();
    const { data: pkg } = await sb.from('packages').insert({
      clinic_id: CLINIC_ID, customer_id: cust!.id, package_name: 'qa-fklink-pkg',
      package_type: 'custom', total_sessions: 1, total_amount: 100000, paid_amount: 0, status: 'active',
    }).select().single();

    try {
      // (3) ledger balance 파생 — 초기 0
      const { data: bal0 } = await sb.rpc('package_credit_balance', { p_account_id: pkg!.id });
      expect(Number(bal0), 'ledger 0-row → balance 0').toBe(0);

      // ledger charge tx 삽입 → balance 파생 = 합
      await sb.from('package_credit_ledger').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, account_type: 'package', account_id: pkg!.id,
        tx_type: 'charge', amount: 70000, memo: 'qa charge',
      });
      await sb.from('package_credit_ledger').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, account_type: 'package', account_id: pkg!.id,
        tx_type: 'use', amount: -20000, memo: 'qa use',
      });
      const { data: bal1 } = await sb.rpc('package_credit_balance', { p_account_id: pkg!.id });
      expect(Number(bal1), 'balance = Σamount (70000-20000)').toBe(50000);

      // (4) package_amendments audit child 삽입 가능
      const amend = await sb.from('package_amendments').insert({
        package_id: pkg!.id, amendment_type: 'regenerate', reason: 'qa lineage',
        before_snapshot: { status: 'active' }, after_snapshot: { status: 'cancelled' },
      }).select().single();
      expect(amend.error, 'package_amendments insert').toBeNull();

      // (1) FK RESTRICT: payment 를 package 에 링크 → 그 package 물리삭제 시도 → RESTRICT 로 실패
      await sb.from('payments').insert({
        customer_id: cust!.id, package_id: pkg!.id, amount: 70000, method: 'card', payment_type: 'payment',
      });
      const del = await sb.from('packages').delete().eq('id', pkg!.id);
      expect(del.error, 'FK RESTRICT — 수납 링크된 패키지 물리삭제 차단(credit fail-closed)').not.toBeNull();
    } finally {
      // 정리(FK 순서: payments → ledger → amendments → package → customer)
      await sb.from('payments').delete().eq('package_id', pkg!.id);
      await sb.from('package_credit_ledger').delete().eq('account_id', pkg!.id);
      await sb.from('package_amendments').delete().eq('package_id', pkg!.id);
      await sb.from('packages').delete().eq('id', pkg!.id);
      await sb.from('customers').delete().eq('id', cust!.id);
    }
  });
});
