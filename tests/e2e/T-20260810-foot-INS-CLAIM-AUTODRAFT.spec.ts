/**
 * E2E spec — T-20260810-foot-INS-CLAIM-AUTODRAFT (B-2)
 * 청구 명세 자동 생성 — service_charges AFTER INSERT 트리거가 draft insurance_claims 를 파생하는지 DB 불변식 검증.
 *
 * 근본원인: insurance_claims=0건. claim 이 수동 패널에서만 생성 → 현장 자동경로(service_charges)는 명세 0건.
 * 해소: trg_service_charges_autodraft → fn_build_insurance_claim_draft (멱등, 금액 verbatim).
 *
 * 불변식:
 *   AC1  급여 service_charges INSERT 시 draft insurance_claims 1건 자동 생성 (트리거 경로)
 *   AC2  claim 합계 = service_charges 금액 VERBATIM (재산출 없음, revenue_insurance_split_spec §2-2)
 *   AC3  hira_code NULL 서비스도 claim_item 으로 남는다 (missing_code 표식 · silent drop 없음)
 *   AC4  같은 check_in 에 covered charge 추가 재삽입 → draft claim 여전히 1건 (멱등 · 이중생성 없음)
 *   AC5  비급여(is_insurance_covered=false) service_charges 는 claim 을 만들지 않는다
 *
 * 실행 전제: 마이그레이션 20260811000000_foot_ins_claim_autodraft_b2 가 대상 DB 에 적용돼야 한다
 *   (apply_before_go — supervisor DB-GATE GO-token 이후). 미적용 시 fn 부재를 프로브해 test.skip.
 *   사전 무영속 검증은 20260811000000_foot_ins_claim_autodraft_b2.dryrun.mjs (No-Persistence Protocol).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

type SB = ReturnType<typeof createClient>;

async function migrationApplied(sb: SB): Promise<boolean> {
  // 존재 프로브: 백필 RPC 호출 (미적용이면 PGRST202/404). 부작용 없음(무매칭 clinic → 0 processed).
  const { error } = await sb.rpc('fn_rollup_insurance_claim_drafts', {
    p_clinic_id: '00000000-0000-0000-0000-000000000000',
    p_from: null,
    p_to: null,
  });
  return !error;
}

async function seedCustomer(sb: SB, suffix: string) {
  const name = `autodraft-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${Math.floor(performance.now())}`;
  const { data, error } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(error, `고객 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

async function seedCheckIn(sb: SB, customerId: string, name: string, phone: string) {
  const { data, error } = await sb.from('check_ins').insert({
    clinic_id: CLINIC_ID, customer_id: customerId, customer_name: name,
    customer_phone: phone, visit_type: 'returning', status: 'done', queue_number: 991,
  }).select().single();
  expect(error, `체크인 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

async function seedService(sb: SB, opts: { hira_code: string | null; hira_score: number; suffix: string }) {
  const { data, error } = await sb.from('services').insert({
    clinic_id: CLINIC_ID,
    name: `autodraft-svc-${opts.suffix}-${Date.now()}`,
    service_code: `ADT${Date.now()}${Math.floor(performance.now())}`.slice(0, 20),
    price: 10000,
    is_insurance_covered: true,
    hira_code: opts.hira_code,
    hira_score: opts.hira_score,
    active: true,
  }).select().single();
  expect(error, `서비스 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

async function insertCharge(sb: SB, opts: {
  checkInId: string; customerId: string; serviceId: string;
  covered: boolean; base: number; coveredAmt: number; copay: number; hira_score?: number | null;
}) {
  const { error } = await sb.from('service_charges').insert({
    clinic_id: CLINIC_ID,
    check_in_id: opts.checkInId,
    customer_id: opts.customerId,
    service_id: opts.serviceId,
    is_insurance_covered: opts.covered,
    hira_score: opts.hira_score ?? null,
    base_amount: opts.base,
    insurance_covered_amount: opts.coveredAmt,
    copayment_amount: opts.copay,
    customer_grade_at_charge: 'general',
  });
  expect(error, `service_charges seed 실패: ${error?.message}`).toBeNull();
}

test.describe('T-20260810-foot-INS-CLAIM-AUTODRAFT', () => {
  test('AC1~AC5: 수납 자동경로 → claim draft 자동생성 · verbatim · missing_code 보존 · 멱등', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    test.skip(!(await migrationApplied(sb)), '마이그 미적용 (GO-token 대기) — dryrun.mjs 로 사전검증');

    const customer = await seedCustomer(sb, 'main');
    const checkIn = await seedCheckIn(sb, customer.id as string, customer.name as string, customer.phone as string);
    const svcCoded = await seedService(sb, { hira_code: 'AA254', hira_score: 139.85, suffix: 'coded' });
    const svcNull = await seedService(sb, { hira_code: null, hira_score: 110.2, suffix: 'nocode' });

    const created = { serviceIds: [svcCoded.id, svcNull.id] as string[] };

    try {
      // ── AC1 + AC2: 급여 charge 2건 INSERT → 트리거가 draft claim 파생 ──
      await insertCharge(sb, { checkInId: checkIn.id as string, customerId: customer.id as string, serviceId: svcCoded.id as string, covered: true, base: 12518, coveredAmt: 8763, copay: 3755, hira_score: 139.85 });
      await insertCharge(sb, { checkInId: checkIn.id as string, customerId: customer.id as string, serviceId: svcNull.id as string, covered: true, base: 9860, coveredAmt: 6902, copay: 2958, hira_score: 110.2 });

      const { data: claims } = await sb.from('insurance_claims')
        .select('id, claim_status, total_base, total_copayment, total_covered, calculation_engine_version')
        .eq('check_in_id', checkIn.id as string).eq('claim_status', 'draft');
      expect(claims, 'AC1 draft claim 자동 생성').toHaveLength(1);
      const claim = claims![0];

      // AC2: 합계 = service_charges verbatim (12518+9860 / 3755+2958 / 8763+6902)
      expect(Number(claim.total_base), 'AC2 total_base verbatim').toBe(12518 + 9860);
      expect(Number(claim.total_copayment), 'AC2 total_copayment verbatim').toBe(3755 + 2958);
      expect(Number(claim.total_covered), 'AC2 total_covered verbatim').toBe(8763 + 6902);
      expect(claim.calculation_engine_version, 'autodraft 프로버넌스').toBe('autodraft_from_charges_v1');

      // ── AC3: claim_items 2건, hira_code NULL 항목 보존 (silent drop 없음) ──
      const { data: items } = await sb.from('claim_items')
        .select('service_id, hira_code, covered_amount, copayment_amount, base_amount')
        .eq('claim_id', claim.id as string);
      expect(items, 'AC3 claim_items 2건 (NULL 미탈락)').toHaveLength(2);
      const nullItem = items!.find((i) => i.service_id === svcNull.id);
      expect(nullItem, 'AC3 hira_code NULL 서비스도 항목 존재').toBeTruthy();
      expect(nullItem!.hira_code, 'AC3 missing_code 표식 = hira_code NULL').toBeNull();
      const codedItem = items!.find((i) => i.service_id === svcCoded.id);
      expect(codedItem!.hira_code, 'AC3 코드 있는 항목은 verbatim').toBe('AA254');
      // 항목 금액도 verbatim
      expect(Number(codedItem!.covered_amount)).toBe(8763);
      expect(Number(nullItem!.covered_amount)).toBe(6902);

      // ── AC4: 같은 check_in 에 covered charge 추가(재저장) → draft 여전히 1건 (멱등) ──
      await insertCharge(sb, { checkInId: checkIn.id as string, customerId: customer.id as string, serviceId: svcCoded.id as string, covered: true, base: 12518, coveredAmt: 8763, copay: 3755, hira_score: 139.85 });
      const { data: claims2 } = await sb.from('insurance_claims')
        .select('id, total_covered').eq('check_in_id', checkIn.id as string).eq('claim_status', 'draft');
      expect(claims2, 'AC4 멱등 — draft claim 여전히 1건 (이중생성 없음)').toHaveLength(1);
      // latest dedup → 총액 불변 (svcCoded 최신 1행만 채택)
      expect(Number(claims2![0].total_covered), 'AC4 재삽입 후에도 총 covered 불변(dedup latest)').toBe(8763 + 6902);
      const { data: items2 } = await sb.from('claim_items').select('service_id').eq('claim_id', claim.id as string);
      expect(items2, 'AC4 재삽입 후 claim_items 여전히 2건').toHaveLength(2);

      // ── AC5: 비급여 charge 는 claim 을 만들지 않는다 ──
      const custNon = await seedCustomer(sb, 'noncov');
      const ciNon = await seedCheckIn(sb, custNon.id as string, custNon.name as string, custNon.phone as string);
      await insertCharge(sb, { checkInId: ciNon.id as string, customerId: custNon.id as string, serviceId: svcCoded.id as string, covered: false, base: 10000, coveredAmt: 0, copay: 10000 });
      const { data: claimsNon } = await sb.from('insurance_claims').select('id').eq('check_in_id', ciNon.id as string);
      expect(claimsNon, 'AC5 비급여 charge 는 claim 미생성').toHaveLength(0);

      // AC5 cleanup
      await sb.from('service_charges').delete().eq('check_in_id', ciNon.id as string);
      await sb.from('check_ins').delete().eq('id', ciNon.id as string);
      await sb.from('customers').delete().eq('id', custNon.id as string);
    } finally {
      // cleanup (claim_items 는 insurance_claims CASCADE)
      const { data: cl } = await sb.from('insurance_claims').select('id').eq('check_in_id', checkIn.id as string);
      for (const c of cl ?? []) await sb.from('claim_items').delete().eq('claim_id', c.id as string);
      await sb.from('insurance_claims').delete().eq('check_in_id', checkIn.id as string);
      await sb.from('service_charges').delete().eq('check_in_id', checkIn.id as string);
      await sb.from('check_ins').delete().eq('id', checkIn.id as string);
      await sb.from('services').delete().in('id', created.serviceIds);
      await sb.from('customers').delete().eq('id', customer.id as string);
    }
  });
});
