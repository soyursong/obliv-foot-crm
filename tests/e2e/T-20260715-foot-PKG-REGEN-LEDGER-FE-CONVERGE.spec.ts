/**
 * T-20260715-foot-PKG-REGEN-LEDGER-FE-CONVERGE
 * 패키지 재생성 FE end-state 수렴 — 원장(package_credit_ledger) charge/use + superseded_by lineage 소비.
 *
 * FE(src/lib/packageCreditLedger.ts) 가 강제하는 불변식을 데이터 계약 레벨에서 검증한다:
 *   AC1: 재생성 = paid_amount 수동 bump 제거 → 원장 re-anchor(use old / charge new) + superseded_by lineage.
 *   AC2: 원장 기준 잔액 정합 — old carry-out 후 잔액 0, new carry-in 후 잔액=이관액. 고아 credit 0(계보 합 보존).
 *   AC3: 재생성 없는 일반 결제 → 원장 charge 정상, superseded_by NULL(SYNC 회귀 0).
 *
 * ⚠ 마이그(package_credit_ledger/superseded_by) 미적용 DB 는 graceful skip(부모 spec 패턴).
 *   service_role 로 계약 검증(RLS 우회). append-only RLS 자체는 supervisor post-deploy 체크.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('PKG-REGEN-LEDGER-FE-CONVERGE — 재생성 원장 수렴 데이터 계약', () => {
  test('재생성 = superseded_by lineage + 원장 re-anchor(잔액 정합·고아 0) / 일반 결제 회귀 0', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // ── 선행: 마이그 적용 여부 프로브(미적용이면 skip) ──
    const ledgerProbe = await sb.from('package_credit_ledger').select('id').limit(0);
    if (ledgerProbe.error) {
      test.skip(true, `마이그 미적용(package_credit_ledger 없음): ${ledgerProbe.error.message}`);
    }
    const supProbe = await sb.from('packages').select('id, superseded_by').limit(0);
    expect(supProbe.error, 'packages.superseded_by 컬럼 존재').toBeNull();

    // ── 시드: 고객 + 활성 패키지 ──
    const { data: cust } = await sb.from('customers')
      .insert({ clinic_id: CLINIC_ID, name: 'qa-regen-fe', phone: '01099999999', visit_type: 'new' })
      .select().single();
    const { data: oldPkg } = await sb.from('packages').insert({
      clinic_id: CLINIC_ID, customer_id: cust!.id, package_name: 'qa-regen-old',
      package_type: 'custom', total_sessions: 3, total_amount: 300000, paid_amount: 0, status: 'active',
    }).select().single();

    let newPkgId: string | null = null;
    try {
      // ── 시나리오 1: charge → 재생성(carry-out old / carry-in new) ──
      // (a) 선납 charge(원장) — canonical 결제 mirror 상당.
      await sb.from('package_credit_ledger').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, account_type: 'package', account_id: oldPkg!.id,
        tx_type: 'charge', amount: 200000, memo: 'qa charge(prepaid)',
      });
      const { data: bal0 } = await sb.rpc('package_credit_balance', { p_account_id: oldPkg!.id });
      expect(Number(bal0), 'charge 후 old 잔액 = 200000').toBe(200000);

      // (b) 재생성: 신규 패키지 + old.superseded_by=new.id + status=cancelled
      const carry = 200000;
      const { data: newPkg } = await sb.from('packages').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, package_name: 'qa-regen-new',
        package_type: 'custom', total_sessions: 3, total_amount: 300000, paid_amount: 0, status: 'active',
      }).select().single();
      newPkgId = newPkg!.id;
      const { data: upd } = await sb.from('packages')
        .update({ superseded_by: newPkgId, status: 'cancelled' })
        .eq('id', oldPkg!.id).eq('status', 'active').select('id');
      expect((upd ?? []).length, 'old lineage 연결 1행').toBe(1);

      // (c) 원장 re-anchor: use(old −carry) + charge(new +carry, reanchored_from=old)
      await sb.from('package_credit_ledger').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, account_type: 'package', account_id: oldPkg!.id,
        tx_type: 'use', amount: -carry, reanchored_from: oldPkg!.id, memo: `재생성 carry-out → ${newPkgId}`,
      });
      await sb.from('package_credit_ledger').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, account_type: 'package', account_id: newPkgId,
        tx_type: 'charge', amount: carry, reanchored_from: oldPkg!.id, memo: `재생성 carry-in ← ${oldPkg!.id}`,
      });

      // AC2: old 잔액 0(carry-out), new 잔액=carry(carry-in) → 원장 기준 정합
      const { data: balOld } = await sb.rpc('package_credit_balance', { p_account_id: oldPkg!.id });
      const { data: balNew } = await sb.rpc('package_credit_balance', { p_account_id: newPkgId });
      expect(Number(balOld), 'old carry-out 후 잔액 0').toBe(0);
      expect(Number(balNew), 'new carry-in 후 잔액 = 이관액').toBe(carry);

      // 고아 credit 0 — 계보(old+new) 합 = 원 charge(순소실 0)
      expect(Number(balOld) + Number(balNew), '계보 합 = 원 선납(고아 0)').toBe(200000);

      // AC1: 재생성 lineage — old.superseded_by=new.id, old cancelled, new active
      const { data: oldAfter } = await sb.from('packages')
        .select('superseded_by, status, paid_amount').eq('id', oldPkg!.id).single();
      expect(oldAfter!.superseded_by, 'old.superseded_by = new.id').toBe(newPkgId);
      expect(oldAfter!.status, 'old = cancelled').toBe('cancelled');

      // new.paid_amount = 원장 파생값 sync(수동 bump 아님)
      await sb.from('packages').update({ paid_amount: carry }).eq('id', newPkgId);
      const { data: newAfter } = await sb.from('packages')
        .select('paid_amount, superseded_by, status').eq('id', newPkgId).single();
      expect(Number(newAfter!.paid_amount), 'new.paid_amount = 원장 파생값').toBe(carry);
      expect(newAfter!.superseded_by, 'new = 현행(최신, superseded_by NULL)').toBeNull();
      expect(newAfter!.status, 'new = active').toBe('active');

      // audit child(regenerate)
      const amend = await sb.from('package_amendments').insert({
        package_id: oldPkg!.id, superseded_by: newPkgId, amendment_type: 'regenerate',
        reason: 'qa regen', before_snapshot: { status: 'active' }, after_snapshot: { carried_credit: carry },
      }).select().single();
      expect(amend.error, 'package_amendments(regenerate) insert').toBeNull();

      // ── 시나리오 2: 재생성 없는 일반 결제 → charge 정상, superseded_by NULL(SYNC 회귀 0) ──
      const { data: plainPkg } = await sb.from('packages').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, package_name: 'qa-plain',
        package_type: 'custom', total_sessions: 1, total_amount: 100000, paid_amount: 0, status: 'active',
      }).select().single();
      await sb.from('package_credit_ledger').insert({
        clinic_id: CLINIC_ID, customer_id: cust!.id, account_type: 'package', account_id: plainPkg!.id,
        tx_type: 'charge', amount: 100000, memo: 'qa plain charge',
      });
      const { data: balPlain } = await sb.rpc('package_credit_balance', { p_account_id: plainPkg!.id });
      expect(Number(balPlain), '일반 결제 charge 정상 = 100000').toBe(100000);
      const { data: plainAfter } = await sb.from('packages').select('superseded_by').eq('id', plainPkg!.id).single();
      expect(plainAfter!.superseded_by, '재생성 없음 → superseded_by NULL(회귀 0)').toBeNull();

      // 정리(plain)
      await sb.from('package_credit_ledger').delete().eq('account_id', plainPkg!.id);
      await sb.from('packages').delete().eq('id', plainPkg!.id);
    } finally {
      // 정리(FK 순서: ledger → amendments → packages → customer)
      await sb.from('package_credit_ledger').delete().eq('customer_id', cust!.id);
      await sb.from('package_amendments').delete().eq('package_id', oldPkg!.id);
      if (newPkgId) await sb.from('packages').delete().eq('id', newPkgId);
      await sb.from('packages').delete().eq('id', oldPkg!.id);
      await sb.from('customers').delete().eq('id', cust!.id);
    }
  });
});
