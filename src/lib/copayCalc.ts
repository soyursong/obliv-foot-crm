/**
 * copayCalc.ts — 공통 건보 본인부담 산출 순수 함수
 *
 * T-20260520-ins-COPAY-CALC (공통 라이브러리 추출)
 * T-20260520-foot-INS-UI   (풋센터 통합 - AC-1)
 *
 * 서버 RPC calc_copayment와 동일 로직.
 * 클라이언트 미리보기 + 단위테스트용.
 * 순수 함수 — 외부 의존 없음, import type만 허용.
 *
 * T-20260720-foot-COPAY-AGE-DERIVED-AUTO (§2/§4): 이 함수는 **등급을 입력으로 받는다** — RPC 미러
 *   불변(grade-based). elderly_flat·infant 는 자격등급이 아니라 나이 파생 속성이므로, 그 등급을
 *   생년월일로 결정하는 것은 이 계산 **이전** 단계(customerAge.ts deriveAgeCopayGrade →
 *   loadEffectiveInsuranceGrade)에서 수행된다. 여기서는 이미 해소된 등급으로 산식만 적용한다
 *   (나이 계산 사본 신설 금지, §3/§9). 자격 미확인(등급 미상 + 나이 미상)이면 상위에서 등급을 날조하지
 *   않고 null 로 위임 → 아래 blockedResult/폴백 경로가 처리한다(임의 폴백 금지, §6/AC-8).
 */

import type { InsuranceGrade } from './insurance';

// ──────────────────────────────────────────────────────────
// Input / Output 타입
// ──────────────────────────────────────────────────────────

export interface CopayCalcServiceInput {
  /** 급여 여부 */
  is_insurance_covered: boolean | null;
  /** HIRA 점수 (수가 = score × hira_unit_value) */
  hira_score: number | null;
  /** 서비스별 본인부담률 오버라이드 (NULL = 등급별 기본값) */
  copayment_rate_override: number | null;
  /** 비급여 폴백용 정가 */
  price: number;
}

export interface CopayCalcClinicInput {
  /**
   * 점수당 원(환산지수, 원). governed data — 하드코딩 fallback 없음.
   * NULL = 데이터 불완전 → data_incomplete=true BLOCK (임의 상수 계산강행 금지).
   * (T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE)
   */
  hira_unit_value: number | null;
}

export interface CopayCalcResult {
  base_amount: number;
  insurance_covered_amount: number;
  copayment_amount: number;
  exempt_amount: number;
  applied_rate: number;
  applied_grade: InsuranceGrade;
  /**
   * 데이터 불완전 플래그 (급여서비스인데 산출 근거 미비 = 거짓완전성 결함 방지).
   * true = 급여 서비스 × (hira_score NULL / hira_unit_value NULL).
   *   grade-universal 진실 — general 포함(§2-2-1b canon 에 general 이 누락됐던 결함 정정,
   *   T-20260725-HIRASCORE-NULL-GENERAL-DATAINCOMPLETE-PARITY-GUARD / DA MSG-20260725-193942-ci9q).
   * ★ severity 는 data_incomplete_block 이 분리 판정한다(⚠BINDING: 단일 gate 오용 방지) —
   *   true 만으로 hard-block 하지 말 것. block=false 이면 WARN(정가 임시부과) 이다.
   */
  data_incomplete: boolean;
  /**
   * data_incomplete 심각도 분리 플래그 (⚠BINDING severity carrier).
   *  · true  = hard-BLOCK. 산출 불가 → 모든 금액 0(금액 날조 금지, §2-2-1b).
   *            capped(차상위/의료급여/노인정액)·등급미상 = 환수불가 harm → 확정 차단.
   *  · false = WARN(가역). general/grade=null 급여×hira_score NULL = 환수-safe fallback
   *            (covered=0, copay=price-full) 진행 허용 + '데이터미비' 배지. 눈앞 환자 hard-lockout 금지.
   * 소비지점이 '단일 data_incomplete gate' 여도 이 플래그로 block/warn 을 grade-aware 하게 분기해야 함.
   */
  data_incomplete_block: boolean;
}

// ──────────────────────────────────────────────────────────
// 등급별 기본 본인부담률
// ──────────────────────────────────────────────────────────

/**
 * 등급별 기본 본인부담률 반환.
 * RPC calc_copayment 의 v_rate CASE 분기와 동일.
 */
export function getBaseCopayRate(grade: InsuranceGrade): number {
  switch (grade) {
    case 'general':       return 0.30;
    // ★[v1.6 GRADE-BRANCH — T-20260720-foot-COPAY-GRADE-BRANCH-MISSING] 차상위·의급 정액/면제.
    //   현행 14%/15% 정률은 "입원·병원급 요율을 의원급 외래에 오적용"한 것(DA 재확정 GO,
    //   da_ratify_copayment_grade_rates_20260720). foot=의원급 1차 외래 → 정액/면제가 정본.
    //   근거: 의료급여법 시행령 별표1(의급 1·2종 의원외래 1,000) / 국민건강보험법 시행령 별표2 3호 라목(차상위).
    //   ▷ 이 rate 는 정보성(applied_rate)일 뿐, 실 copay 는 copayFromBase 의 면제·정액 분기가 정본.
    //     정액/면제 등급은 medical_aid_1(0.00) 관행과 통일(DA §applied_rate sub-note, non-blocking).
    //   ⚠ SCOPE: 의원급(1차) 외래 전용. 병원급·입원은 14%/15%/10% 정률 정본 — 타 CRM 재사용 금지.
    case 'low_income_1':  return 0.00; // 면제 (차상위 희귀·중증난치·중증) → copay 0원
    case 'low_income_2':  return 0.00; // 정액 1,000원 (차상위 만성·18세미만) — 종전 0.14 오적용
    case 'medical_aid_1': return 0.00; // 정액 1,000원 (의료급여 1종) — 유지
    case 'medical_aid_2': return 0.00; // 정액 1,000원 (의료급여 2종) — 종전 0.15 오적용
    case 'infant':        return 0.21;
    case 'elderly_flat':  return 0.30; // 정액제 분기는 calcCopayment 내에서 처리
    case 'foreigner':     return 1.00;
    case 'unverified':
    default:              return 0.30;
  }
}

/**
 * 등급별 본인부담 '기준' 라벨 텍스트 (화면·서류 공유 SSOT).
 *
 * 정액/면제/노인 정률제 등급은 단일 % 로 표현할 수 없다(정액=금액, 면제=0원,
 * elderly=4구간 정률제). getBaseCopayRate 를 직접 `%` 로 찍으면 v1.6 에서 정액/면제
 * 등급이 "0%", elderly 가 "30%" 로 **오표기**되므로(§3-6), 라벨 표시부는 이 기준명을 쓴다.
 * 정률(general/infant) 및 등급미상(unverified·급여 방문)은 null → 호출부가 "N%" 를 표시.
 *
 * (T-20260720-foot-COPAY-GRADE-BRANCH-MISSING §3-6 — getBaseCopayRate 직접 %표기의
 *  elderly '30%' 오표기 + v1.6 정액/면제 '0%' 오표기 정정. 값 산정과 무관·표시 전용.)
 */
export function copayBasisText(grade: InsuranceGrade): string | null {
  switch (grade) {
    case 'low_income_1':  return '면제';       // 차상위 희귀·중증난치·중증 → 0원
    case 'medical_aid_1':
    case 'medical_aid_2':
    case 'low_income_2':  return '정액';       // 의급 1·2종 / 차상위 만성·18세미만 → 정액 1,000원
    case 'elderly_flat':  return '정률제';     // 노인 외래 4구간(정액1,500 / 10 / 20 / 30%)
    case 'foreigner':     return '전액';       // 100% 본인부담
    default:              return null;         // general/infant/unverified → 호출부가 % 표기
  }
}

// ──────────────────────────────────────────────────────────
// 등급→copay 단일 SSOT 헬퍼 (병렬 재계산 경로 신설 금지, DA §제약1)
// ──────────────────────────────────────────────────────────

/**
 * 등급 + base(급여 수가 또는 급여 진료비 합) → 본인부담금(copay).
 *
 * calcCopayment(RPC calc_copayment v1.6 미러)와 footBilling 3계산기(computeFootBilling /
 * fillBillItemCopayment / 문서출력)가 **공유하는 유일한 등급→copay 규칙**이다. 등급 분기는
 * 오직 이 한 곳에서만 정의한다 — 병렬 재계산 경로 신설 금지(DA §제약1: SSOT 단일소비).
 *
 * 분기 (의원급 1차 외래 scope):
 *  · low_income_1                          → 0원 (면제; 시행령 별표2 3호 라목)
 *  · medical_aid_1/2 · low_income_2        → LEAST(1,000, base) 정액 (의료급여법 별표1 / 시행령 별표2)
 *  · elderly_flat (override 없음)          → 노인 외래 4구간(≤15,000 정액1,500 / ~20,000 10% / ~25,000 20% / >25,000 30%)
 *  · general/infant/unverified/ELSE        → FLOOR(base × rate / 100) × 100 (100원 미만 절사)
 *  정률경로·노인 정률구간 = 100원 미만 절사(FLOOR). CIT-2026-001/002 + revenue_insurance_split §2-2 v1.12.
 *
 * @param grade       건보 등급
 * @param base        급여 base (RPC=ROUND(hira_score×hira_unit_value), footBilling=급여 진료비 합)
 * @param rate        적용 정률(0~1). override 있으면 override, 없으면 getBaseCopayRate(grade). 정률경로에만 사용.
 * @param hasOverride copayment_rate_override 존재 여부 — elderly 4구간 흡수(→정률경로) 판정에만 사용.
 */
export function copayFromBase(
  grade: InsuranceGrade,
  base: number,
  rate: number,
  hasOverride: boolean,
): number {
  if (base <= 0) return 0;

  // 면제 — 차상위 희귀·중증난치·중증 (시행령 별표2 3호 라목). 본인부담 0원.
  if (grade === 'low_income_1') return 0;

  // 정액 1,000원 (직접조제 1,500 edge 미대상) — 의급 1·2종 / 차상위 만성·18세미만 의원 외래.
  if (grade === 'medical_aid_1' || grade === 'low_income_2' || grade === 'medical_aid_2') {
    return Math.min(1000, base);
  }

  // 노인 외래 정률제 4구간 (65세+, 의원급). override 있으면 정률경로(아래)로 흡수(개별 실손 자기부담률 우선).
  //   ★[ROUNDING] 정률구간 100원 미만 절사(FLOOR). 시행령 별표2 §19① / 심평원 외래기준. (T-20260714)
  if (grade === 'elderly_flat' && !hasOverride) {
    let copay: number;
    if (base <= 15000) {
      copay = Math.min(1500, base);                     // 정액 1,500 (절사 무영향)
    } else if (base <= 20000) {
      copay = Math.floor((base * 0.10) / 100) * 100;    // 10% · 100원 미만 절사
    } else if (base <= 25000) {
      copay = Math.floor((base * 0.20) / 100) * 100;    // 20% · 100원 미만 절사
    } else {
      copay = Math.floor((base * 0.30) / 100) * 100;    // 30% · 100원 미만 절사
    }
    return Math.min(copay, base);
  }

  // 일반 정률경로 (general/infant/unverified/ELSE) — 100원 미만 절사(FLOOR, v1.5 정정 유지).
  return Math.min(Math.floor((base * rate) / 100) * 100, base);
}

// ──────────────────────────────────────────────────────────
// 방문(visit) grain 재배분 — T-20260819-foot-COPAY-VISIT-GRAIN
// ──────────────────────────────────────────────────────────

/** 방문 grain 재배분 입력 1행. calcCopaymentBatch 결과 + 급여 여부. */
export interface VisitCopayItem {
  /** service_charges/서비스 식별자 — 잔차 tie-break 결정론 키(iteration-order 비의존). */
  service_id: string;
  /** 급여 여부(services.is_insurance_covered). 비급여/외국인 항목은 pool 미참여(per-item 전액 유지). */
  is_insurance_covered: boolean | null;
  /** 단건 calc_copayment 결과(pool base = base_amount, 비급여/미비 항목 판정에 사용). */
  result: CopayCalcResult;
}

/**
 * 방문(visit) grain 본인부담 재배분 — 항목당(item) 합산 결함 교정.
 *
 * T-20260819-foot-COPAY-VISIT-GRAIN (DA CONSULT-REPLY MSG-20260819-132529-kma1, design A):
 *   본인부담금은 규정상 **방문 단위**다. calcCopaymentBatch(단건 calc_copayment × N)를 그대로 합산하면
 *   의급/차상위(정액 min(1000,base))는 항목마다 1,000원 → N항목=N,000원 과다징수, 노인정액은 항목별
 *   구간판정으로 총액구간 오판이 된다. 이 함수는 급여 항목들의 base 를 **방문 총액으로 pool** 한 뒤
 *   copayFromBase 를 **1회** 적용하고 비례배분+잔차보정으로 항목에 되돌린다 —
 *   footBilling.fillBillItemCopayment(:1015) 과 **동일 method 의 mirror**(canonical METHOD source).
 *
 * ★ sum-consistency = governing invariant: Σ copayment_amount = copayFromBase(grade, coveredSum) 보존.
 *   per-item 배분 자체는 내부분배(no regulatory 제약, DA C2) — 잔차는 결정론 tie-break(소수부 desc,
 *   동률 시 service_id asc)로 iteration-order 비의존(멱등, DA C4).
 *
 * 규칙:
 *  · pool 대상 = is_insurance_covered && base_amount>0 && !data_incomplete && grade≠foreigner.
 *  · 비급여/외국인/data_incomplete = pool 미참여 → 단건 결과 그대로(전액 본인부담/BLOCK 보존).
 *  · 서버 calc_visit_copayment 와 byte-identical(client↔server 발산 0, DoD#4).
 *
 * @returns 입력 순서 보존, copayment_amount/insurance_covered_amount 만 재배분한 새 결과 배열.
 */
export function redistributeVisitCopayment(
  items: VisitCopayItem[],
  grade: InsuranceGrade | null,
): VisitCopayItem[] {
  // 외국인/등급 미상(null)/pool 대상 0건 → 무변경(단건 결과가 이미 정답).
  if (grade === null || grade === 'foreigner') return items;

  // pool 대상: 급여 + base>0 + 산출가능.
  const pooled = items.filter(
    (it) =>
      it.is_insurance_covered === true &&
      it.result.base_amount > 0 &&
      !it.result.data_incomplete,
  );
  if (pooled.length === 0) return items;

  const coveredSum = pooled.reduce((s, it) => s + it.result.base_amount, 0);
  const rate = getBaseCopayRate(grade);
  // 방문 총액 위에서 등급→copay 를 1회 산출(pool). footBilling 집계 grain 과 동일 hasOverride=false.
  const copaymentTotal = copayFromBase(grade, coveredSum, rate, false);

  // 배분 결과 매핑(service_id → copay).
  const copayById = new Map<string, number>();

  if (copaymentTotal <= 0) {
    // 면제(차상위1)·0 등급: 전 항목 copay 0 → 공단부담=급여전액.
    for (const it of pooled) copayById.set(it.service_id, 0);
  } else {
    // 비례 배분 + 잔차 보정(소수부 큰 순, 동률 시 service_id asc) — fillBillItemCopayment 규칙 mirror.
    let allocated = 0;
    const fracs: Array<{ id: string; frac: number; cap: number }> = [];
    for (const it of pooled) {
      const total = it.result.base_amount;
      const raw = (copaymentTotal * total) / coveredSum;
      const floor = Math.min(Math.floor(raw), total);
      copayById.set(it.service_id, floor);
      allocated += floor;
      fracs.push({ id: it.service_id, frac: raw - Math.floor(raw), cap: total - floor });
    }
    let remainder = copaymentTotal - allocated;
    fracs.sort((a, b) => (b.frac - a.frac) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const f of fracs) {
      if (remainder <= 0) break;
      const add = Math.min(remainder, f.cap);
      copayById.set(f.id, (copayById.get(f.id) ?? 0) + add);
      remainder -= add;
    }
  }

  // 결과 재구성(입력 순서 보존). pool 항목만 copay/covered 갱신, 나머지는 그대로.
  return items.map((it) => {
    if (!copayById.has(it.service_id)) return it;
    const copay = copayById.get(it.service_id)!;
    return {
      ...it,
      result: {
        ...it.result,
        copayment_amount: copay,
        insurance_covered_amount: Math.max(0, it.result.base_amount - copay),
      },
    };
  });
}

/**
 * Map 편의 래퍼 — calcCopaymentBatch 결과(Map)를 방문 grain 으로 재배분.
 * 패널(InsuranceCopaymentPanel/Chart2InsuranceCalcPanel) 소비용.
 *
 * @param results          calcCopaymentBatch 결과(service_id → CopayCalcResult)
 * @param coveredServiceIds is_insurance_covered===true 인 service_id 집합
 * @param grade            방문 고객 건보 등급
 */
export function redistributeVisitCopaymentMap(
  results: Map<string, CopayCalcResult>,
  coveredServiceIds: Set<string>,
  grade: InsuranceGrade | null,
): Map<string, CopayCalcResult> {
  const items: VisitCopayItem[] = Array.from(results.entries()).map(([service_id, result]) => ({
    service_id,
    is_insurance_covered: coveredServiceIds.has(service_id),
    result,
  }));
  const redistributed = redistributeVisitCopayment(items, grade);
  const out = new Map<string, CopayCalcResult>();
  for (const it of redistributed) out.set(it.service_id, it.result);
  return out;
}

// ──────────────────────────────────────────────────────────
// 핵심 산출 함수
// ──────────────────────────────────────────────────────────

/** data_incomplete hard-BLOCK 결과 (금액 날조 금지 — 모두 0, rate 0). block=true. */
function blockedResult(grade: InsuranceGrade): CopayCalcResult {
  return {
    base_amount: 0,
    insurance_covered_amount: 0,
    copayment_amount: 0,
    exempt_amount: 0,
    applied_rate: 0,
    applied_grade: grade,
    data_incomplete: true,
    data_incomplete_block: true,
  };
}

/**
 * 건보 본인부담 산출 (순수 함수) — 서버 RPC calc_copayment v1.6 미러.
 *
 * 산출 규칙 (서버 RPC calc_copayment와 동일):
 *  1. 비급여 or 외국인 → 전액 본인부담 (price 기준)
 *  2. 급여 + hira_score NULL → default-deny (general 만 전액본인부담 fallback, 그 외 BLOCK) [NULLFIX v1.2]
 *  3. 점당단가(hira_unit_value) NULL → data_incomplete BLOCK (89.4 fallback 제거) [이슈1]
 *  4. copayment_rate_override 있으면 우선 적용(정률경로·elderly 흡수에만)
 *  5. 등급→copay = copayFromBase 단일 SSOT 헬퍼 (병렬 재계산 경로 신설 금지):
 *       · low_income_1 → 0원(면제) [v1.6 신설 · 시행령 별표2 3호 라목]
 *       · medical_aid_1/2 · low_income_2 → MIN(1,000, 수가) 정액 [v1.6: 의급2·차상위2 정률→정액 정정]
 *       · elderly_flat(override 없음) → 노인 외래 4구간(≤15,000 정액1,500 / 10% / 20% / 30%, FLOOR)
 *       · general/infant/unverified/ELSE → FLOOR(base × rate / 100) × 100 (100원 미만 절사, v1.5)
 *         [CIT-2026-001/002 외래 본인부담 전반 FLOOR. 종전 CEIL 초과징수 정정]
 *  ⚠ 정액/면제 값 = 의원급(1차) 외래 전용. 병원급·입원 재사용 금지(cross-CRM SCOPE CAVEAT).
 *  (T-20260720-foot-COPAY-GRADE-BRANCH-MISSING — DA 재확정 GO, da_ratify_copayment_grade_rates_20260720)
 */
export function calcCopayment(
  service: CopayCalcServiceInput,
  clinic: CopayCalcClinicInput,
  grade: InsuranceGrade,
): CopayCalcResult {
  const isCovered = !!service.is_insurance_covered;

  // ── 1. 비급여 / 외국인 → 전액 본인부담 ────────────────
  if (!isCovered || grade === 'foreigner') {
    const base = service.price ?? 0;
    return {
      base_amount: base,
      insurance_covered_amount: 0,
      copayment_amount: base,
      exempt_amount: 0,
      applied_rate: 1.0,
      applied_grade: grade,
      // 비급여/외국인 = 정상 전액본인부담. 급여 근거 미비가 아니므로 data_incomplete=false.
      data_incomplete: false,
      data_incomplete_block: false,
    };
  }

  // ── 2. 급여 + hira_score NULL ───────────────────────────────────────────
  //   급여 서비스인데 수가 점수(hira_score)가 비어 있음 = 산출근거 미비.
  //   T-20260725-HIRASCORE-NULL-GENERAL-DATAINCOMPLETE-PARITY-GUARD (DA MSG-20260725-193942-ci9q):
  //     · general = 종전 data_incomplete=FALSE 로 '무경고 정가부과' → 거짓완전성 결함(§2-2-1b 에 general 누락).
  //       → data_incomplete=TRUE(honest, grade-universal) 로 정정하되 severity=WARN(block=false):
  //         환수-safe fallback(정가·covered=0·copay=price-full) 그대로 진행 + '데이터미비' 배지 노출.
  //         ⚠ 70% 공단 하드코딩 절대금지 — covered=0 유지(§2-2-4 판정2 phantom 날조 방지). 금액 무변경(가역).
  //     · capped(차상위/의료급여/노인정액)·등급미상 = 환수불가 harm → hard-BLOCK 유지(blockedResult, §2-2-1b 불변).
  if (service.hira_score == null) {
    if (grade === 'general') {
      const base = service.price ?? 0;
      return {
        base_amount: base,
        insurance_covered_amount: 0,   // phantom 공단 금지 — covered=0 (70% 하드코딩 금지)
        copayment_amount: base,        // 환수-safe fallback: 정가 임시부과
        exempt_amount: 0,
        applied_rate: 1.0,
        applied_grade: grade,
        data_incomplete: true,         // honest: 급여×점수미비 = 데이터 불완전(grade-universal parity)
        data_incomplete_block: false,  // WARN: 정가 부과 진행 허용(hard-block 아님) → 점수 입력 후 재정산
      };
    }
    // low_income_1/2·infant·medical_aid·elderly·unverified 등 → hard-BLOCK (환수불가 harm)
    return blockedResult(grade);
  }

  // ── 3. 점당단가 governed: NULL → BLOCK (89.4 fallback 제거) [이슈1] ──────
  if (clinic.hira_unit_value == null) {
    return blockedResult(grade);
  }

  // ── 4. 수가 산출 ──────────────────────────────────────
  const baseRate = getBaseCopayRate(grade);
  // OVERRIDE-RULE: O-001 — 서비스별 실손보험 자기부담률 개별 적용
  // OVERRIDE: copayCalc — copayment_rate_override 서비스별 자기부담률 추가 적용. 기본 로직 전체 연동.
  const hasOverride = service.copayment_rate_override != null;
  const rate = service.copayment_rate_override ?? baseRate;
  const base = Math.round(service.hira_score * clinic.hira_unit_value);

  // ── 5·6·7. 정액/면제/정률 분기 — 단일 SSOT 헬퍼(copayFromBase) 소비. ──────────
  //   등급→copay 규칙은 copayFromBase 한 곳에만 존재(RPC calc_copayment v1.6 · footBilling 3계산기 공유).
  //   병렬 재계산 경로 신설 금지(DA §제약1). v1.6 델타: low_income_1 면제(0) / low_income_2·medical_aid_2 정액.
  const copay = copayFromBase(grade, base, rate, hasOverride);

  const covered = Math.max(0, base - copay);
  return {
    base_amount: base,
    insurance_covered_amount: covered,
    copayment_amount: copay,
    exempt_amount: 0,
    applied_rate: rate,
    applied_grade: grade,
    data_incomplete: false,
    data_incomplete_block: false,
  };
}
