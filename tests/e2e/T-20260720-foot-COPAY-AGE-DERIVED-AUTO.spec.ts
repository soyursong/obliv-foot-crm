/**
 * T-20260720-foot-COPAY-AGE-DERIVED-AUTO
 *
 * 나이 파생 본인부담 자동 판정 — elderly_flat·infant 를 수기 등급입력이 아닌 생년월일 파생으로 전환.
 *   등급 미설정 89% 대응. 나이 판정 SSOT 1개(customerAge.ts) 확립 + 세기 하드코딩 26 제거(2027 시한폭탄)
 *   + 자격 미확인 시 등급 날조 금지.
 *
 * 검증 축(순수 로직 + 정적 소스 가드, --project=unit, auth/DB 불요·결정론):
 *   AC-1~6  : 나이 파생 등급/율 (customer-age.spec.ts 상세 — 여기선 대표 케이스 + 산식 정합 재확인)
 *   AC-9    : 세기 하드코딩 26 제거 — KohReportTab 소스에 '<= 26' 잔존 0 + SSOT 동적 세기 2027 판정
 *   AC-10   : SSOT 수렴 — format.birthYearAgeDisplay·KohReportTab.formatBirthYearWithAge·나이파생이
 *             모두 customerAge.computeAgeFromBirth 를 위임(사본 증식 0) → 표시값·계산값 일치
 *   배선     : footBilling.loadEffectiveInsuranceGrade 가 fn_customer_birthdates RPC 재사용 + 나이파생 주입,
 *             명시 등급 미접촉(회귀 0), calcCopayment 는 grade-only(RPC 미러 불변)
 *
 * 진짜 게이트(라이브 청구 반영) = supervisor field-soak(등급 미설정 65세/영유아 실 청구).
 * 실행: npx playwright test T-20260720-foot-COPAY-AGE-DERIVED-AUTO.spec.ts --project=unit
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  computeAgeFromBirth,
  deriveAgeCopayGrade,
  parseBirthYMD,
  resolveEffectiveGradeWithAge,
} from '../../src/lib/customerAge';
import { birthYearAgeDisplay, birthDateYMD, todaySeoulISODate } from '../../src/lib/format';
import { calcCopaymentLocal, type ServiceLike } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const KOH = path.join(ROOT, 'src/components/doctor/KohReportTab.tsx');
const FORMAT = path.join(ROOT, 'src/lib/format.ts');
const JUDGE = path.join(ROOT, 'src/lib/insuranceGradeJudge.ts');
const FOOTBILLING = path.join(ROOT, 'src/lib/footBilling.ts');
const COPAYCALC = path.join(ROOT, 'src/lib/copayCalc.ts');
const CUSTOMERAGE = path.join(ROOT, 'src/lib/customerAge.ts');

const TODAY = '2026-07-20';
const read = (p: string) => fs.readFileSync(p, 'utf8');

// ── AC-9: 세기 하드코딩 26 제거 (2027 시한폭탄 가드) ────────────────────────────
test.describe('AC-9 세기 하드코딩 26 제거 (시한폭탄 가드)', () => {
  test('KohReportTab 소스에 하드코딩 세기 리터럴("<= 26"/"<=26") 잔존 0', () => {
    const src = read(KOH);
    expect(src).not.toMatch(/<=\s*26/);
    expect(src).not.toMatch(/yy\s*>=\s*0\s*&&\s*yy\s*<=\s*26/);
  });

  test('format.ts 소스에 하드코딩 세기 폴백("yy <= curYY ? 2000")·new Date() 나이산식 잔존 0', () => {
    const src = read(FORMAT);
    // birthYearAgeDisplay/birthDateYMD 의 자체 세기 산식 제거 → parseBirthYMD 위임만 남음.
    expect(src).not.toMatch(/yy\s*<=\s*curYY\s*\?\s*2000/);
    expect(src).toMatch(/parseBirthYMD/); // SSOT 위임 확인
  });

  test('27년생을 2027-01-01 판정 → 2027년생(만0세) (하드코딩 26이었다면 1927/만100세 오판)', () => {
    expect(parseBirthYMD('270101', '2027-01-01')?.year).toBe(2027);
    expect(computeAgeFromBirth('270101', '2027-01-01')).toBe(0);
    // 완전연도(RPC 8자리) 소스는 세기 무관 항상 정확
    expect(parseBirthYMD('2027-01-01', '2027-01-01')?.year).toBe(2027);
  });
});

// ── AC-10: SSOT 수렴 (사본 증식 0, 표시=계산 일치) ─────────────────────────────
test.describe('AC-10 나이 판정 SSOT 수렴', () => {
  test('format/Koh/judge 가 customerAge SSOT(computeAgeFromBirth/parseBirthYMD)를 위임', () => {
    expect(read(FORMAT)).toMatch(/from '\.\/customerAge'/);
    expect(read(KOH)).toMatch(/from '@\/lib\/customerAge'/);
    expect(read(JUDGE)).toMatch(/computeAgeFromBirth/);
    // judge 는 자체 new Date(nowMs) 세기 산식을 제거하고 SSOT 위임만 남긴다.
    expect(read(JUDGE)).not.toMatch(/const\s+curYY\s*=\s*now\.getFullYear/);
  });

  test('format.birthYearAgeDisplay 표시값의 만나이 = computeAgeFromBirth(동일 SSOT)', () => {
    // birthYearAgeDisplay 는 내부적으로 todaySeoulISODate() 사용 → 같은 KST 기준일로 대조.
    const today = todaySeoulISODate();
    for (const b of ['1961-07-20', '1990-03-15', '2021-01-10', '1926-05-15']) {
      const age = computeAgeFromBirth(b, today);
      const disp = birthYearAgeDisplay(b);
      if (age != null) expect(disp).toContain(`만 ${age}세`);
      const y = parseBirthYMD(b, today)!.year;
      expect(disp).toContain(String(y));
    }
  });

  test('birthDateYMD 도 parseBirthYMD 위임 — 8자리 RPC 값 정확 표기', () => {
    expect(birthDateYMD('1926-05-15')).toBe('1926.05.15');
    expect(birthDateYMD('19900315')).toBe('1990.03.15');
  });
});

// ── AC-1~6: 나이 파생 등급 + 산식 정합 (대표 케이스) ───────────────────────────
test.describe('AC-1~6 나이 파생 등급 → 산식', () => {
  const consult: ServiceLike = {
    is_insurance_covered: true,
    hira_score: 153.36, // base = ROUND(153.36 * 89.4) = 13,710
    copayment_rate_override: null,
    price: 0,
  };
  const clinic = { hira_unit_value: 89.4 };

  test('AC-1: 등급 미설정 + 만65세(생일당일) → elderly_flat 자동, 노인정액 1,500원', () => {
    const grade = resolveEffectiveGradeWithAge(null, '1961-07-20', TODAY).grade!;
    expect(grade).toBe('elderly_flat');
    const r = calcCopaymentLocal(consult, clinic, grade);
    expect(r.copayment_amount).toBe(1500); // base 13,710 ≤ 15,000 → 정액 1,500 (일반 30% 4,100 아님)
  });

  test('AC-2: 만64세(생일전날) → 나이 파생 없음(일반 30% 위임)', () => {
    expect(resolveEffectiveGradeWithAge(null, '1961-07-21', TODAY).grade).toBeNull();
  });

  test('AC-4: 만0세 → infant + 1세미만 5% (SSOT 세부율)', () => {
    const r = deriveAgeCopayGrade('2026-01-10', TODAY);
    expect(r?.grade).toBe('infant');
    expect(r?.rate).toBe(0.05);
  });

  test('AC-5: 만5세 → infant 21%, 산식 2,800원', () => {
    const grade = resolveEffectiveGradeWithAge(null, '2021-01-10', TODAY).grade!;
    expect(grade).toBe('infant');
    const r = calcCopaymentLocal(consult, clinic, grade);
    expect(r.applied_rate).toBe(0.21);
    expect(r.copayment_amount).toBe(2800);
  });

  test('AC-6: 만6세 → 나이 파생 없음(일반 위임)', () => {
    expect(resolveEffectiveGradeWithAge(null, '2020-01-10', TODAY).grade).toBeNull();
  });
});

// ── 배선/불변식 가드 ──────────────────────────────────────────────────────────
test.describe('배선 가드 (RPC 재사용 · 명시등급 미접촉 · db_change 0)', () => {
  test('footBilling.loadEffectiveInsuranceGrade 가 fn_customer_birthdates RPC 재사용 + 나이파생 주입', () => {
    const src = read(FOOTBILLING);
    expect(src).toMatch(/fn_customer_birthdates/);
    expect(src).toMatch(/deriveAgeCopayGrade/);
    // 명시 등급(unverified 제외)은 early-return(미접촉).
    expect(src).toMatch(/live\s*&&\s*live\s*!==\s*'unverified'/);
  });

  test('AC-8: 나이 미상 시 등급 날조 금지 — deriveAgeCopayGrade null 반환 경로', () => {
    expect(deriveAgeCopayGrade(null, TODAY)).toBeNull();
    expect(deriveAgeCopayGrade('', TODAY)).toBeNull();
    expect(resolveEffectiveGradeWithAge(null, null, TODAY).ageDerived).toBe(false);
  });

  test('customerAge SSOT 자체는 클라 세기 휴리스틱 하드코딩 리터럴 없음(동적 세기만)', () => {
    const src = read(CUSTOMERAGE);
    expect(src).not.toMatch(/<=\s*26\b/); // 하드코딩 연도 금지
    expect(src).toMatch(/todayYear\s*%\s*100/); // 동적 세기 경계
  });

  test('db_change 0 — 본 티켓 신규 마이그레이션 파일 없음(RPC 재사용)', () => {
    // 나이 판정은 기존 fn_customer_birthdates(20260613120000) 재사용. 신규 마이그 없음.
    const migDir = path.join(ROOT, 'supabase/migrations');
    const files = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    expect(files.some((f) => f.includes('COPAY-AGE-DERIVED') || f.includes('copay_age_derived'))).toBe(false);
  });
});
