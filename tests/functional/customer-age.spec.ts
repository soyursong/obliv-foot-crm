/**
 * 나이 파생 본인부담 자동 판정 — 나이 SSOT 단위 테스트
 *
 * T-20260720-foot-COPAY-AGE-DERIVED-AUTO
 *
 * customerAge.ts(나이 판정 단일 SSOT)의 순수 함수를 AC-1~AC-10 기준으로 검증.
 *   · computeAgeFromBirth  — KST 만나이(생일당일 포함) + 세기 정확판정(8자리 RPC) + 동적 세기(6자리)
 *   · deriveAgeCopayGrade  — 65세+ elderly_flat / 6세미만 infant(5%/21%) / 그 외 null / 미상 null(날조금지)
 *   · resolveEffectiveGradeWithAge — 나이 파생은 null/unverified 일 때만 개입(명시 등급 미접촉)
 *
 * 기준일(todayISO)을 인자로 주입 → 시계 무의존(결정성). 2026-07-20 = 티켓 §7 시나리오 기준.
 */

import { test, expect } from '@playwright/test';
import {
  computeAgeFromBirth,
  deriveAgeCopayGrade,
  parseBirthYMD,
  resolveEffectiveGradeWithAge,
} from '../../src/lib/customerAge';
import { calcCopaymentLocal, type ServiceLike } from '../../src/lib/insurance';

const TODAY = '2026-07-20'; // 티켓 §7 시나리오 기준일(KST)

test.describe('나이 SSOT — computeAgeFromBirth (경계·세기)', () => {
  test('AC-1: 1961-07-20, 오늘 2026-07-20(생일당일) → 만65세', () => {
    expect(computeAgeFromBirth('1961-07-20', TODAY)).toBe(65);
  });

  test('AC-2: 1961-07-21, 오늘 2026-07-20(생일전날) → 만64세', () => {
    expect(computeAgeFromBirth('1961-07-21', TODAY)).toBe(64);
  });

  test('AC-3: 1926-05-15(RPC 완전연도) → 만100세 (0세 오판 없음, 휴리스틱 결함 회귀가드)', () => {
    // 서버 RPC fn_customer_birthdates 는 세기코드로 'YYYY-MM-DD'(8자리) 정확판정 → 1926 그대로.
    // 클라 6자리 휴리스틱(yy<=curYY?2000:1900)이었다면 '260515'→2026(0세)로 오판할 위험 → 8자리 소스로 봉합.
    expect(parseBirthYMD('1926-05-15', TODAY)?.year).toBe(1926);
    expect(computeAgeFromBirth('1926-05-15', TODAY)).toBe(100);
  });

  test('YYYY-MM-DD(하이픈) / YYYYMMDD(8자리) 동치 파싱', () => {
    expect(computeAgeFromBirth('19900315', TODAY)).toBe(computeAgeFromBirth('1990-03-15', TODAY));
  });

  test('AC-9: 27년생 데이터를 2027-01-01 시각 판정 → 2027년생(하드코딩 26 제거, 시한폭탄 가드)', () => {
    // 하드코딩 '26' 이었다면 27→1927(만100세)로 오판. 동적 세기(기준연도 %100)라 27→2027(만0세).
    expect(parseBirthYMD('270101', '2027-01-01')?.year).toBe(2027);
    expect(computeAgeFromBirth('270101', '2027-01-01')).toBe(0);
    // 완전연도(RPC) 소스는 세기 무관하게 항상 정확.
    expect(parseBirthYMD('2027-01-01', '2027-01-01')?.year).toBe(2027);
  });

  test('결측/파싱불가 → null (등급 날조 방지 기반)', () => {
    expect(computeAgeFromBirth(null, TODAY)).toBeNull();
    expect(computeAgeFromBirth('', TODAY)).toBeNull();
    expect(computeAgeFromBirth('abc', TODAY)).toBeNull();
    expect(computeAgeFromBirth('991350', TODAY)).toBeNull(); // 13월/50일 불가
  });
});

test.describe('나이 SSOT — deriveAgeCopayGrade (나이 파생 등급)', () => {
  test('AC-1: 만65세(생일당일) → elderly_flat', () => {
    const r = deriveAgeCopayGrade('1961-07-20', TODAY);
    expect(r?.grade).toBe('elderly_flat');
    expect(r?.rate).toBeNull(); // 노인 4구간 → rate 없음(copayFromBase base 분기)
  });

  test('AC-2: 만64세 → 나이 파생 없음(null, 일반 인구)', () => {
    expect(deriveAgeCopayGrade('1961-07-21', TODAY)).toBeNull();
  });

  test('AC-3: 만100세 → elderly_flat', () => {
    expect(deriveAgeCopayGrade('1926-05-15', TODAY)?.grade).toBe('elderly_flat');
  });

  test('AC-4: 2026-01-10(만0세) → infant, 1세미만 5%', () => {
    const r = deriveAgeCopayGrade('2026-01-10', TODAY);
    expect(r?.grade).toBe('infant');
    expect(r?.rate).toBe(0.05);
    expect(r?.age).toBe(0);
  });

  test('AC-5: 2021-01-10(만5세) → infant, 6세미만 21%', () => {
    const r = deriveAgeCopayGrade('2021-01-10', TODAY);
    expect(r?.grade).toBe('infant');
    expect(r?.rate).toBe(0.21);
    expect(r?.age).toBe(5);
  });

  test('AC-6: 2020-01-10(만6세) → 나이 파생 없음(null, 일반)', () => {
    expect(deriveAgeCopayGrade('2020-01-10', TODAY)).toBeNull();
  });

  test('1세 경계: 만1세(생일당일) → 21% (5%는 만0세 한정)', () => {
    // 2025-07-20 생, 오늘 2026-07-20 = 만1세 → 6세미만 21%
    const r = deriveAgeCopayGrade('2025-07-20', TODAY);
    expect(r?.grade).toBe('infant');
    expect(r?.rate).toBe(0.21);
  });

  test('AC-8: birth 미상(파싱 불가) → null (임의 폴백/등급 날조 금지)', () => {
    expect(deriveAgeCopayGrade(null, TODAY)).toBeNull();
    expect(deriveAgeCopayGrade('', TODAY)).toBeNull();
  });
});

test.describe('나이 SSOT — resolveEffectiveGradeWithAge (등급 해소)', () => {
  test('등급 미설정(null) + 만65세 → 나이 파생 elderly_flat', () => {
    const r = resolveEffectiveGradeWithAge(null, '1961-07-20', TODAY);
    expect(r.grade).toBe('elderly_flat');
    expect(r.ageDerived).toBe(true);
  });

  test('unverified + 만5세 → 나이 파생 infant', () => {
    const r = resolveEffectiveGradeWithAge('unverified', '2021-01-10', TODAY);
    expect(r.grade).toBe('infant');
    expect(r.ageDerived).toBe(true);
    expect(r.rate).toBe(0.21);
  });

  test('명시 등급(general)은 나이 파생이 덮지 않음 (65세라도 general 유지, 회귀 0)', () => {
    const r = resolveEffectiveGradeWithAge('general', '1961-07-20', TODAY);
    expect(r.grade).toBe('general');
    expect(r.ageDerived).toBe(false);
  });

  test('명시 등급(의료급여/차상위)은 나이 파생이 덮지 않음 (자격축 우선)', () => {
    expect(resolveEffectiveGradeWithAge('medical_aid_1', '1961-07-20', TODAY).grade).toBe('medical_aid_1');
    expect(resolveEffectiveGradeWithAge('low_income_2', '2021-01-10', TODAY).grade).toBe('low_income_2');
  });

  test('AC-8: 등급 미상 + 나이 미상(birth 없음) → null (임의 폴백 금지, 등급 미접촉)', () => {
    const r = resolveEffectiveGradeWithAge(null, null, TODAY);
    expect(r.grade).toBeNull();
    expect(r.ageDerived).toBe(false);
    const r2 = resolveEffectiveGradeWithAge('unverified', null, TODAY);
    expect(r2.grade).toBe('unverified'); // unverified 는 보존(무회귀)
    expect(r2.ageDerived).toBe(false);
  });

  test('등급 미설정 + 만64세(비대상) → null (나이 특례 없음, 기존 폴백 위임)', () => {
    expect(resolveEffectiveGradeWithAge(null, '1961-07-21', TODAY).grade).toBeNull();
  });
});

test.describe('나이 파생 등급 → calcCopaymentLocal 산식 정합 (E2E 변환 근거)', () => {
  // 진찰료 초진(153.36점) × 환산지수 89.4 = base 13,710
  const consult: ServiceLike = {
    is_insurance_covered: true,
    hira_score: 153.36,
    copayment_rate_override: null,
    price: 0,
  };
  const clinic = { hira_unit_value: 89.4 };

  test('시나리오1: 나이 파생 elderly_flat → 노인정액제 산식 (base>15,000 이므로 정률구간)', () => {
    const grade = resolveEffectiveGradeWithAge(null, '1961-07-20', TODAY).grade!;
    expect(grade).toBe('elderly_flat');
    const r = calcCopaymentLocal(consult, clinic, grade);
    // base 13,710 ≤ 15,000 → 노인 정액 1,500원 (일반 30% 4,100원과 다름 = 자동 정확)
    expect(r.base_amount).toBe(13710);
    expect(r.copayment_amount).toBe(1500);
    expect(r.applied_grade).toBe('elderly_flat');
  });

  test('시나리오2: 나이 파생 infant(6세미만) → 21% 산식', () => {
    const grade = resolveEffectiveGradeWithAge(null, '2021-01-10', TODAY).grade!;
    expect(grade).toBe('infant');
    const r = calcCopaymentLocal(consult, clinic, grade);
    expect(r.applied_rate).toBe(0.21);
    // FLOOR(13710*0.21/100)*100 = 2,800
    expect(r.copayment_amount).toBe(2800);
  });

  test('시나리오3 엣지: 만64세 → 나이 파생 없음 → (등급 미상 폴백은 상위 정책; 나이축은 미개입)', () => {
    expect(resolveEffectiveGradeWithAge(null, '1961-07-21', TODAY).grade).toBeNull();
  });
});
