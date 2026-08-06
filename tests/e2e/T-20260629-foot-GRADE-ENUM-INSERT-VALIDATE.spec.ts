/**
 * T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — 자격등급 값-집합 + service_charges INSERT-path 검증/정규화
 *
 * 권위: DA-20260806-foot-GRADE-ENUM-2-2-2-FINALIZE (MSG-20260806-193530-najs)
 *
 * ⚠ 실행 전제: 3개 마이그(194000 enum add / 194100 trigger / 194200 backfill)가 DB 에 적용된 상태.
 *   supervisor 가 마이그 apply 후 본 스펙으로 계약을 회귀검증한다(deploy-ready 마킹은 dryrun 3종 PASS 가 근거).
 *
 * service role 클라이언트 사용 = RLS 는 우회하지만 BEFORE INSERT 트리거·CHECK 제약은 우회 못 함
 *   → AC-0(CHECK)·AC-1/AC-2(trigger) 를 순수 DB-계약 레벨에서 검증(로그인/UX 의존 0).
 *
 * 시나리오:
 *   A (AC-1) service_charges grade='manual' INSERT → 거부(sentinel = 등급 아님)
 *   B (AC-1) grade='일반' INSERT → 성공 + 저장값 'general' 로 정규화
 *   C (AC-2) copayment_rate_at_charge=NULL INSERT → 거부(applied_rate 필수 계약)
 *   D (AC-1) grade='near_poor' + rate INSERT → 성공(canonical 값-집합 통과)
 *   E (AC-0) customers.insurance_grade='near_poor'/'veteran' UPDATE → 성공(CHECK 확장)
 *   F (AC-0) customers.insurance_grade 비-canonical('bogus') → CHECK 위반 거부
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MARKER = 'GRADE-VALIDATE-E2E';
const ENGINE = 'GRADE-VALIDATE-E2E';

let sb: SupabaseClient;
let clinicId: string;
let checkInId: string;
let serviceId: string;
let customerId: string;

async function insertCharge(over: Record<string, unknown>) {
  return sb.from('service_charges').insert({
    clinic_id: clinicId,
    check_in_id: checkInId,
    customer_id: customerId,
    service_id: serviceId,
    is_insurance_covered: false,
    base_amount: 10000,
    insurance_covered_amount: 0,
    copayment_amount: 10000,
    exempt_amount: 0,
    customer_grade_at_charge: 'general',
    copayment_rate_at_charge: 1.0,
    calculation_engine_version: ENGINE,
    ...over,
  }).select('id, customer_grade_at_charge');
}

test.beforeAll(async () => {
  sb = createClient(SUPA_URL, SERVICE_KEY);
  // 실 FK id 확보(읽기) — check_in/service/clinic 재사용, customer 는 시드.
  const { data: ci } = await sb.from('check_ins').select('id, clinic_id').limit(1).single();
  checkInId = (ci as { id: string }).id;
  clinicId = (ci as { clinic_id: string }).clinic_id;
  const { data: svc } = await sb.from('services').select('id').limit(1).single();
  serviceId = (svc as { id: string }).id;
  const { data: c } = await sb
    .from('customers')
    .insert({ clinic_id: clinicId, name: `${MARKER}`, phone: `DUMMY-${MARKER}-${Date.now()}`, visit_type: 'new' })
    .select('id').single();
  customerId = (c as { id: string }).id;
});

test.afterAll(async () => {
  if (!sb) return;
  await sb.from('service_charges').delete().eq('calculation_engine_version', ENGINE);
  if (customerId) await sb.from('customers').delete().eq('id', customerId);
});

test.describe('GRADE-ENUM-INSERT-VALIDATE (DB 계약)', () => {
  test('A (AC-1) grade=manual INSERT → 거부(sentinel)', async () => {
    const { data, error } = await insertCharge({ customer_grade_at_charge: 'manual' });
    expect(error, 'manual 은 거부되어야 함').not.toBeNull();
    expect(data).toBeNull();
    expect(`${error?.message}`).toContain('비-canonical');
  });

  test("B (AC-1) grade='일반' INSERT → 성공 + 'general' 정규화", async () => {
    const { data, error } = await insertCharge({ customer_grade_at_charge: '일반' });
    expect(error, `정규화 성공해야 함: ${error?.message}`).toBeNull();
    expect(data?.[0]?.customer_grade_at_charge).toBe('general');
  });

  test('C (AC-2) rate=NULL INSERT → 거부(applied_rate 필수)', async () => {
    const { data, error } = await insertCharge({ copayment_rate_at_charge: null });
    expect(error, 'rate NULL 은 거부되어야 함').not.toBeNull();
    expect(data).toBeNull();
    expect(`${error?.message}`).toContain('applied_rate');
  });

  test('D (AC-1) grade=near_poor + rate INSERT → 성공(canonical 통과)', async () => {
    const { data, error } = await insertCharge({
      customer_grade_at_charge: 'near_poor',
      copayment_rate_at_charge: 0.2,
    });
    expect(error, `near_poor canonical 이어야 함: ${error?.message}`).toBeNull();
    expect(data?.[0]?.customer_grade_at_charge).toBe('near_poor');
  });

  test('E (AC-0) customers.insurance_grade = near_poor / veteran → 성공(CHECK 확장)', async () => {
    for (const g of ['near_poor', 'veteran']) {
      const { error } = await sb.from('customers').update({ insurance_grade: g }).eq('id', customerId);
      expect(error, `${g} CHECK 통과해야 함: ${error?.message}`).toBeNull();
    }
  });

  test('F (AC-0) customers.insurance_grade = 비-canonical → CHECK 거부', async () => {
    const { error } = await sb.from('customers').update({ insurance_grade: 'bogus_grade' }).eq('id', customerId);
    expect(error, '비-canonical 은 CHECK 로 거부되어야 함').not.toBeNull();
  });
});
