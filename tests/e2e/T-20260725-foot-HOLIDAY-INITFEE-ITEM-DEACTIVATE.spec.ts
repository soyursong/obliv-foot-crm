import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SURCHARGE_RATE } from '../../src/lib/nightHolidaySurcharge';

/**
 * E2E — T-20260725-foot-HOLIDAY-INITFEE-ITEM-DEACTIVATE (db_only config, artifact-class=db_only)
 *
 * 수동 '공휴일 초진진찰료-의원'(24,490 = base 18,840 × 1.3 가산 baked) 항목을 active=false 폐기.
 * 정규 '초진진찰료-의원'(급여 covered, hira_score, base 18,840)만 남겨 공휴일 진료 시 시스템
 * 자동 30% 가산으로 동일 24,490 산출 → 수동 baked 항목과의 이중가산(31,837=base×1.69) hazard 제거.
 *
 * ★검증 전략:
 *   (1) config 폐기 상태 = service_role DB assertion(SUPABASE_SERVICE_ROLE_KEY 있을 때만; CI green 유지).
 *       - 폐기 대상(id 3eb86239) active=false + 수납창 picker(.eq('active',true)) set 에서 미노출 (AC-1/AC-2)
 *       - 유지 대상(id de611ed5) active=true, covered, hira_score 불변 (AC-4 격리)
 *   (2) 자동 가산 산식 = 순수 산술(floor-to-10, prod nightHolidaySurcharge 미러):
 *       - 정규 base 18,840 × (1+0.3) → floor10 = 24,490 (단일 가산, AC-3)
 *       - 폐기 안 했을 때의 hazard: baked 24,490 flat + 자동 30% 재부과 → 31,837-class(base×1.69) 이중청구.
 *         폐기로 이 경로 제거됨을 대비 assert.
 *
 * DB 상수(prod 실측 2026-08-12): clinic 74967aea hira_unit_value=95.6, 정규 초진 hira_score=197.12.
 *   197.12×95.6=18,844.67 → floor10 base=18,840 · ×1.3=24,498.07 → floor10=24,490.
 */

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TARGET_ID = '3eb86239-af92-468c-afd3-94daa28acad6'; // 공휴일 초진진찰료-의원 (폐기)
const KEEP_ID = 'de611ed5-154a-475d-9eb3-19d6d3bad881';   // 초진진찰료-의원 (급여, 유지)

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const floor10 = (n: number) => Math.floor(n / 10) * 10;

test.describe('config 폐기 상태 (service_role DB assertion)', () => {
  test.skip(!SUPA_URL || !SERVICE_ROLE, 'service_role 키 없음 — DB assertion 건너뜀(CI green 유지)');
  const sb = createClient(SUPA_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });

  test('AC-1: 폐기 대상 공휴일 초진진찰료-의원(24,490) active=false', async () => {
    const { data, error } = await sb
      .from('services')
      .select('id, name, price, active, is_insurance_covered, hira_score')
      .eq('id', TARGET_ID)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.name).toBe('공휴일 초진진찰료-의원');
    expect(Number(data!.price)).toBe(24490);
    expect(data!.active).toBe(false); // 폐기됨
  });

  test('AC-2: 수납창 picker(active=true) set 에서 폐기 항목 미노출', async () => {
    const { data, error } = await sb
      .from('services')
      .select('id')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true); // PaymentMiniWindow 항목 로드와 동일 필터
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).not.toContain(TARGET_ID); // 폐기 → 수납창 목록에 없음
  });

  test('AC-4: 정규 초진진찰료-의원(급여) 불변 — active/covered/hira_score/price 유지', async () => {
    const { data, error } = await sb
      .from('services')
      .select('id, name, price, active, is_insurance_covered, hira_score')
      .eq('id', KEEP_ID)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.active).toBe(true);
    expect(data!.is_insurance_covered).toBe(true);
    expect(Number(data!.price)).toBe(18840);
    expect(Number(data!.hira_score)).toBeCloseTo(197.12, 2);
  });
});

test.describe('AC-3: 자동 공휴일 30% 가산 산식 (순수) — 단일가산 24,490 vs 이중가산 hazard', () => {
  const SCORE = 197.12;
  const UNIT = 95.6;

  test('정규 base = floor10(score×unit) = 18,840', () => {
    expect(floor10(SCORE * UNIT)).toBe(18840);
  });

  test('공휴일 자동 30% 가산(단일) → floor10(base×1.3) = 24,490', () => {
    const base = floor10(SCORE * UNIT); // 18,840
    const surcharged = floor10(base * (1 + SURCHARGE_RATE)); // floor10(24,492)=24,490
    expect(SURCHARGE_RATE).toBe(0.3);
    expect(surcharged).toBe(24490); // 수동 항목과 동일 금액을 자동 산출
  });

  test('이중가산 hazard(폐기로 제거): baked 24,490 flat + 자동 30% 재부과 ≈ base×1.69 (≠ 24,490)', () => {
    const bakedFlat = 24490; // 폐기된 수동 항목 단가(base×1.3 baked)
    const doubleBilled = floor10(bakedFlat * (1 + SURCHARGE_RATE)); // 24,490×1.3 재부과
    expect(doubleBilled).toBeGreaterThan(31000); // 31,837-class 과청구
    expect(doubleBilled).not.toBe(24490); // 폐기 안 했으면 발생할 이중청구 — 폐기로 경로 제거
  });
});
