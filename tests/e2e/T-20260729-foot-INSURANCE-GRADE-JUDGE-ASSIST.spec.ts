/**
 * E2E/unit spec — T-20260729-foot-INSURANCE-GRADE-JUDGE-ASSIST
 *
 * 건강보험 자격등급 "판정 보조 계산기": 데스크가 요양기관정보마당 조회결과의 값만 각 칸에 긁어
 * 붙이면(또는 드롭다운 선택) 필드별 좁은 키워드 매칭으로 9등급 중 하나를 **추천**한다.
 * 추천일 뿐 — 최종 확정은 사람(기존 updateInsuranceGrade SECDEF RPC 재사용).
 *
 * 검증(§8) = 지시서 시나리오 1~4:
 *  · 시나리오1: 매칭표 전항 → 올바른 등급 추천(건강보험/의급1·2/차상위1·2/외국인).
 *  · 시나리오2: 나이 자동(6세미만/65세) + 급여종별 충돌 우선순위(급여종별 우선).
 *  · 시나리오3: 4종(산정특례·희귀난치·보훈·종별불명) → 미확인(unverified) 안전 폴백.
 *  · 시나리오4: 무접촉 회귀0 — 등급 enum/CHECK/copayFromBase/COVERED_GRADES 손대지 않음 +
 *             저장은 기존 SECDEF RPC(update_insurance_grade) 재사용(새 write 경로 없음) + db_change=false.
 *  + §2 하드닝: "희귀난치·중증·보훈"은 "차상위" 동시 출현 시에만 차상위1, 단독=unverified(환수 차단).
 *
 * 매칭·나이는 순수 함수(insuranceGradeJudge.ts) — 결정적 단위검증. write 없음(추천만).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  judgeInsuranceGrade,
  ageFromBirthValue,
  type JudgeInput,
} from '../../src/lib/insuranceGradeJudge';
import type { InsuranceGrade } from '../../src/lib/insurance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// 기준시각 고정 — 나이 계산 결정성(테스트 재현성). 2026-07-29.
const NOW = new Date('2026-07-29T09:00:00+09:00').getTime();

function judge(partial: Partial<JudgeInput>) {
  return judgeInsuranceGrade({
    benefitText: '',
    reliefText: '',
    isForeigner: false,
    ageYears: null,
    ...partial,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — 매칭표 전항 → 올바른 등급 추천', () => {
  const cases: { benefit: string; relief: string; foreigner?: boolean; expect: InsuranceGrade }[] = [
    { benefit: '건강보험', relief: '', expect: 'general' },
    { benefit: '직장가입자', relief: '', expect: 'general' },
    { benefit: '지역', relief: '', expect: 'general' },
    { benefit: '의료급여 1종', relief: '', expect: 'medical_aid_1' },
    { benefit: '의료급여 2종', relief: '', expect: 'medical_aid_2' },
    { benefit: '건강보험', relief: '차상위 1종', expect: 'low_income_1' },
    { benefit: '건강보험', relief: '차상위 2종', expect: 'low_income_2' },
    { benefit: '건강보험', relief: '차상위 만성', expect: 'low_income_2' },
    { benefit: '', relief: '', foreigner: true, expect: 'foreigner' },
    { benefit: '외국인', relief: '', expect: 'foreigner' },
  ];
  for (const c of cases) {
    test(`"${c.benefit || '(공란)'}" + "${c.relief || '(공란)'}"${c.foreigner ? ' +외국인' : ''} → ${c.expect}`, () => {
      const r = judge({ benefitText: c.benefit, reliefText: c.relief, isForeigner: !!c.foreigner });
      expect(r.recommended).toBe(c.expect);
    });
  }

  test('공백·대소문자 무시(포함검사) — "의료급여1종" 붙여쓰기도 인식', () => {
    expect(judge({ benefitText: '의료급여1종' }).recommended).toBe('medical_aid_1');
  });

  test('빈칸 = 자동선택 0 (§1.6) — recommended null', () => {
    expect(judge({}).recommended).toBeNull();
  });

  test('인식 에코(§1 UX2) — 붙인 값이 무엇으로 읽혔는지 표시', () => {
    const r = judge({ benefitText: '의료급여 1종', reliefText: '차상위 2종' });
    expect(r.echo.benefit.recognized).toContain('의료급여 1종');
    expect(r.echo.relief.recognized).toContain('차상위 2종');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 — 나이 자동 + 급여종별 충돌 우선순위(§3)', () => {
  test('만 6세 미만(건보) → infant', () => {
    expect(judge({ benefitText: '건강보험', ageYears: 3 }).recommended).toBe('infant');
  });
  test('만 65세 이상(건보) → elderly_flat', () => {
    expect(judge({ benefitText: '건강보험', ageYears: 70 }).recommended).toBe('elderly_flat');
  });
  test('빈칸 + 나이만 있어도 나이 추천(§3)', () => {
    expect(judge({ ageYears: 2 }).recommended).toBe('infant');
    expect(judge({ ageYears: 80 }).recommended).toBe('elderly_flat');
  });
  test('충돌 우선순위 — 65세 + 의료급여1종 → 급여종별 우선(medical_aid_1, 나이 무시)', () => {
    expect(judge({ benefitText: '의료급여 1종', ageYears: 70 }).recommended).toBe('medical_aid_1');
  });
  test('충돌 우선순위 — 3세 + 차상위2종 → 차상위 우선(low_income_2, 나이 무시)', () => {
    expect(judge({ benefitText: '건강보험', reliefText: '차상위 2종', ageYears: 3 }).recommended).toBe('low_income_2');
  });
  test('중간 연령(건보) → general 유지(나이정액 아님)', () => {
    expect(judge({ benefitText: '건강보험', ageYears: 40 }).recommended).toBe('general');
  });

  test('ageFromBirthValue — RPC YYYY-MM-DD(완전연도, 세기 정확)', () => {
    expect(ageFromBirthValue('1956-01-01', NOW)).toBe(70);
    expect(ageFromBirthValue('2024-01-01', NOW)).toBe(2);
    expect(ageFromBirthValue('2026-06-01', NOW)).toBe(0);
  });
  test('ageFromBirthValue — 생일 전이면 만나이 -1', () => {
    // 2026-07-29 기준, 생일 2026-08-01(YYYYMMDD 8자리) 아직 안 지남
    expect(ageFromBirthValue('19600801', NOW)).toBe(65);
    expect(ageFromBirthValue('19600701', NOW)).toBe(66);
  });
  test('ageFromBirthValue — YYMMDD 폴백 세기 경계 동적(시한폭탄 없음)', () => {
    // 2026 기준 curYY=26: '90' → 1990(66세), '05' → 2005(21세)
    expect(ageFromBirthValue('900101', NOW)).toBe(36);
    expect(ageFromBirthValue('050101', NOW)).toBe(21);
  });
  test('ageFromBirthValue — 결측/이상치 → null(나이 추천 생략)', () => {
    expect(ageFromBirthValue(null, NOW)).toBeNull();
    expect(ageFromBirthValue('', NOW)).toBeNull();
    expect(ageFromBirthValue('12', NOW)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 — 4종 미확인(unverified) 안전 폴백(§4)', () => {
  test('산정특례 단독 → unverified + 메모 안내', () => {
    const r = judge({ benefitText: '건강보험', reliefText: '산정특례' });
    expect(r.recommended).toBe('unverified');
    expect(r.needsMemoNote).toBe(true);
  });
  test('희귀난치 단독(차상위 아님) → unverified', () => {
    expect(judge({ benefitText: '건강보험 희귀난치' }).recommended).toBe('unverified');
  });
  test('보훈/국가유공 단독 → unverified', () => {
    expect(judge({ reliefText: '보훈' }).recommended).toBe('unverified');
    expect(judge({ reliefText: '국가유공자' }).recommended).toBe('unverified');
  });
  test('차상위인데 종별(1/2) 불명 → unverified(부담률 확정 불가)', () => {
    const r = judge({ benefitText: '건강보험', reliefText: '차상위' });
    expect(r.recommended).toBe('unverified');
    expect(r.needsMemoNote).toBe(true);
  });
  test('의료급여인데 종별 불명 → unverified', () => {
    expect(judge({ benefitText: '의료급여' }).recommended).toBe('unverified');
  });
  test('매칭 규칙에 안 걸리는 값 → unverified(억지 추측 금지)', () => {
    expect(judge({ benefitText: '알수없는텍스트' }).recommended).toBe('unverified');
  });
  test('산정특례/희귀난치 + 나이 65세 → 나이정액으로 덮지 않음(unverified 유지)', () => {
    // §4 안전집합: unverified 는 "일반 건보 대상" 아님 → 나이정액 적용 안 함(오분류=환수 차단).
    expect(judge({ reliefText: '산정특례', ageYears: 70 }).recommended).toBe('unverified');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('§2 하드닝 — 희귀난치·중증·보훈은 "차상위" 동시 출현 시에만 차상위1', () => {
  test('차상위 + 희귀난치 → low_income_1 (동시 출현)', () => {
    expect(judge({ benefitText: '건강보험', reliefText: '차상위 희귀난치' }).recommended).toBe('low_income_1');
  });
  test('차상위 + 중증 → low_income_1 (동시 출현)', () => {
    expect(judge({ benefitText: '건강보험', reliefText: '차상위 중증' }).recommended).toBe('low_income_1');
  });
  test('희귀난치 단독(차상위 없음) → unverified (NOT 차상위1)', () => {
    expect(judge({ reliefText: '희귀난치' }).recommended).toBe('unverified');
  });
  test('중증 단독 → unverified (산정특례 오분류 방지)', () => {
    expect(judge({ reliefText: '중증' }).recommended).toBe('unverified');
  });
  test('보훈 단독 → unverified (차상위1 면제 오분류 = 환수)', () => {
    expect(judge({ reliefText: '보훈' }).recommended).toBe('unverified');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오4 — 무접촉 회귀0 (등급체계 4곳 + 저장경로 + db_change)', () => {
  const insuranceSrc = fs.readFileSync(path.join(ROOT, 'src/lib/insurance.ts'), 'utf8');
  const footBillingSrc = fs.readFileSync(path.join(ROOT, 'src/lib/footBilling.ts'), 'utf8');
  const copayCalcSrc = fs.readFileSync(path.join(ROOT, 'src/lib/copayCalc.ts'), 'utf8');
  const useInsuranceSrc = fs.readFileSync(path.join(ROOT, 'src/hooks/useInsurance.ts'), 'utf8');

  test('등급 enum 9종 무변경(insurance.ts InsuranceGrade)', () => {
    for (const g of [
      'general', 'low_income_1', 'low_income_2', 'medical_aid_1', 'medical_aid_2',
      'infant', 'elderly_flat', 'foreigner', 'unverified',
    ]) {
      expect(insuranceSrc).toContain(`'${g}'`);
    }
  });

  test('COVERED_GRADES(footBilling.ts) 실재 — 무접촉', () => {
    expect(footBillingSrc).toContain('COVERED_GRADES');
  });

  test('copayFromBase(copayCalc.ts) 실재 — 무접촉', () => {
    expect(copayCalcSrc).toContain('copayFromBase');
  });

  test('저장은 기존 SECDEF RPC(update_insurance_grade) 재사용 — 새 write 경로 없음', () => {
    expect(useInsuranceSrc).toContain("rpc('update_insurance_grade'");
    // customers 직접 UPDATE(SECDEF 우회) 신설 금지 확인 — grade write 는 RPC 경유만.
    expect(useInsuranceSrc).not.toContain(".update({ insurance_grade");
  });

  test('db_change=false — 이 티켓 신규 마이그레이션 파일 없음', () => {
    const migDir = path.join(ROOT, 'supabase/migrations');
    const migs = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const judgeMigs = migs.filter((f) => /INSURANCE-GRADE-JUDGE|insurance_grade_judge/i.test(f));
    expect(judgeMigs).toEqual([]);
  });

  test('판정 보조는 추천만(write 없음) — judge 결과는 순수 데이터', () => {
    const r = judge({ benefitText: '의료급여 1종' });
    expect(r).toHaveProperty('recommended');
    expect(r).toHaveProperty('echo');
    // 함수 호출로 어떤 side-effect 도 없음(순수) — 반복 호출 동일 결과.
    expect(judge({ benefitText: '의료급여 1종' }).recommended).toBe(r.recommended);
  });
});
