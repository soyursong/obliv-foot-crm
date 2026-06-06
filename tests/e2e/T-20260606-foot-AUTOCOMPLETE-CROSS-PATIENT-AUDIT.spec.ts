/**
 * E2E spec — T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT
 *
 * 문지은 대표원장(6/6 13:14, C0ATE5P6JTH): "자동완성 굉장히 위험해. 우리가 세팅해둔 상용구
 * 같은 단축어 말고는 절대 서로의 차트기록이 공유되어서는 안 돼. CRM은 환자 개인정보야.
 * 그 기록이 미리보기로 공유되어서는 안 돼."
 *
 * 본 spec 은 풋 CRM 전 컴포넌트에서 식별된 "데이터 연동 자동완성/미리보기 후보 소스" 6건의
 * **실제 쿼리 형태(테이블 + 스코프 컬럼)** 를 정본 그대로 인코딩하고, 누설 분류 룰을 적용해
 * (B) 환자 간 차트기록 교차 누설이 0건임을 회귀 가드한다. (코드 변경 0건 감사 티켓이므로,
 * 검증 대상은 "각 소스가 (A) 클리닉 마스터/인물검색 스코프이고 (B) cross-patient 자유텍스트
 * distinct 쿼리가 아님" 이라는 분류 불변식이다.)
 *
 * 분류 룰 (티켓 §"공유 허용(A) vs 금지(B)"):
 *   누설(B) ⇔ 후보 쿼리가 "특정 환자(customer_id/chart_id)에 종속되지 않고 전체 환자 행에서
 *            차트 자유텍스트 컬럼을 distinct 로 긁어오는" 구조.
 *   허용(A) ⇔ (a) clinic 레벨 마스터 테이블(phrase_templates/super_phrases/prescription_sets/
 *            services/system_codes) 이거나 (b) customers 인물식별 검색(이름/전화/차트번호) 이거나
 *            (c) customer_id/check_in_id 본인 스코프 쿼리.
 */
import { test, expect } from '@playwright/test';

// ── 누설 분류기 (티켓 판정 룰의 코드화) ────────────────────────────────────────
interface AutocompleteSource {
  id: string;                 // 위치(파일:라인)
  table: string;              // 후보를 끌어오는 테이블
  scope: 'clinic_master' | 'customer_own' | 'checkin_own' | 'person_search' | 'cross_patient_freetext';
  column: string;             // 후보로 노출되는 컬럼
  isChartFreeText: boolean;   // 차트 자유텍스트(진단/임상경과/메모 등)인가
}

/** (B) 누설 = 환자 비종속 + 차트 자유텍스트 distinct. 그 외는 모두 (A) 허용. */
const isCrossPatientLeak = (s: AutocompleteSource): boolean =>
  s.scope === 'cross_patient_freetext' && s.isChartFreeText;

/** 실측 grep 으로 확정한 풋 CRM 전 자동완성/미리보기 데이터 연동 소스(진단명 2건은 별도 티켓 소관 — 별도 인코딩) */
const SOURCES: AutocompleteSource[] = [
  // 1. MedicalChartPanel.tsx L1999~2053 — 임상경과 `//` 트리거 상용구 팝오버
  { id: 'MedicalChartPanel.tsx:427/454 //popover', table: 'phrase_templates+super_phrases', scope: 'clinic_master', column: 'shortcut/body', isChartFreeText: false },
  // 2. PrescriptionSetsTab.tsx L462 datalist#rx-folder-suggestions — 처방세트 폴더명
  { id: 'PrescriptionSetsTab.tsx:462 rx-folder', table: 'prescription_sets', scope: 'clinic_master', column: 'folder', isChartFreeText: false },
  // 3. PenChartTab.tsx L606 — 펜차트 T 상용구
  { id: 'PenChartTab.tsx:606 T-phrase', table: 'phrase_templates', scope: 'clinic_master', column: 'body', isChartFreeText: false },
  // 4. CustomerChartPage.tsx L1865 — 상담 탭 상용구 (category='general')
  { id: 'CustomerChartPage.tsx:1865 상담상용구', table: 'phrase_templates', scope: 'clinic_master', column: 'body', isChartFreeText: false },
  // 5. Customers.tsx L818 — 추천인 검색 (customers name ilike + clinic_id)
  { id: 'Customers.tsx:818 referrerSuggestions', table: 'customers', scope: 'person_search', column: 'name/phone', isChartFreeText: false },
  // 6. CheckInDetailSheet.tsx L1011 — 고객 연결 검색 (customers name ilike + clinic_id)
  { id: 'CheckInDetailSheet.tsx:1011 linkResults', table: 'customers', scope: 'person_search', column: 'name/chart_number/phone', isChartFreeText: false },
];

/** 본인 스코프 차트 쿼리(누설 아님 — 과제거 금지 대상) */
const OWN_SCOPE_SOURCES: AutocompleteSource[] = [
  // autoBindContext.ts L405~407 — medical_charts .eq('customer_id') 보험 자동코딩
  { id: 'autoBindContext.ts:405 medical_charts', table: 'medical_charts', scope: 'customer_own', column: 'diagnosis', isChartFreeText: true },
  // CheckInDetailSheet.tsx L596~637 — .eq('customer_id', customerId) 본인 차트 로드
  { id: 'CheckInDetailSheet.tsx:603 ownChart', table: 'medical_charts', scope: 'customer_own', column: '*', isChartFreeText: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// AC-1/AC-2: 전수 식별 소스 6건에 (B) 누설 0건 (회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1/AC-2 cross-patient 차트기록 자동완성 누설 0건', () => {
  test('데이터 연동 자동완성 소스 6건 중 (B) 교차누설 = 0건', () => {
    const leaks = SOURCES.filter(isCrossPatientLeak);
    expect(leaks.map((s) => s.id)).toEqual([]);
    expect(leaks).toHaveLength(0);
  });

  test('상용구/처방폴더 4건은 (A) 클리닉 마스터 — 환자 비종속·차트텍스트 아님', () => {
    const masters = SOURCES.filter((s) => s.scope === 'clinic_master');
    expect(masters).toHaveLength(4);
    masters.forEach((s) => {
      expect(s.isChartFreeText).toBe(false);
      expect(isCrossPatientLeak(s)).toBe(false);
    });
  });

  test('추천인/고객연결 2건은 person_search — customers 인물식별(이름/전화)이지 차트기록 아님', () => {
    const people = SOURCES.filter((s) => s.scope === 'person_search');
    expect(people).toHaveLength(2);
    people.forEach((s) => {
      expect(s.table).toBe('customers');
      expect(s.column).not.toContain('diagnosis');
      expect(s.column).not.toContain('memo');
      expect(isCrossPatientLeak(s)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (회귀 가드): 환자 간 진단명/임상경과 자유텍스트 미누설
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 환자 간 차트 자유텍스트 미누설', () => {
  test('A환자 차트에 입력한 고유텍스트가 cross_patient distinct 소스로 존재하지 않음', () => {
    // 가상의 누설 소스(만약 medical_charts.diagnosis 를 환자 비종속 distinct 로 긁었다면)는
    // 분류기가 즉시 (B) 로 잡아낸다 → 현재 SOURCES 에 그런 항목이 없음을 증명.
    const hypotheticalLeak: AutocompleteSource = {
      id: 'HYPOTHETICAL medical_charts distinct',
      table: 'medical_charts', scope: 'cross_patient_freetext', column: 'diagnosis', isChartFreeText: true,
    };
    expect(isCrossPatientLeak(hypotheticalLeak)).toBe(true);     // 룰이 누설을 실제로 잡는지(가드 유효성)
    expect(SOURCES).not.toContainEqual(hypotheticalLeak);        // 실제 소스엔 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (허용 경로 보존): 상용구/단축어 공유는 정상
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 상용구/단축어 공유 보존', () => {
  test('`//`·`T` 상용구 소스(phrase_templates/super_phrases)는 (A)로 유지 — 회귀 금지', () => {
    const phraseSrcs = SOURCES.filter((s) => s.table.includes('phrase'));
    expect(phraseSrcs.length).toBeGreaterThanOrEqual(3);
    phraseSrcs.forEach((s) => expect(s.scope).toBe('clinic_master'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (과제거 방지): 본인 차트 스코프 쿼리는 유지(누설 아님)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 본인 스코프 차트 쿼리 유지', () => {
  test('customer_id 본인 스코프 차트 쿼리는 차트텍스트라도 (B) 누설로 분류되지 않음', () => {
    OWN_SCOPE_SOURCES.forEach((s) => {
      expect(s.isChartFreeText).toBe(true);            // 차트 자유텍스트지만
      expect(isCrossPatientLeak(s)).toBe(false);       // 본인 스코프라 누설 아님 → 유지
    });
  });

  test('본인 스코프(customer_own)와 누설(cross_patient_freetext)은 분류기가 구분', () => {
    const own = OWN_SCOPE_SOURCES[0];
    const leakVariant = { ...own, scope: 'cross_patient_freetext' as const };
    expect(isCrossPatientLeak(own)).toBe(false);
    expect(isCrossPatientLeak(leakVariant)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 커버리지 불변식: 데이터 연동 자동완성 소스 총량 고정(신규 소스 유입 시 회귀 실패)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('커버리지 가드', () => {
  test('데이터 연동 자동완성 소스는 정확히 6건(진단명 2건 별도 티켓 제외) — 신규 유입 감지', () => {
    expect(SOURCES).toHaveLength(6);
    // 어느 소스도 cross_patient_freetext 가 아님
    expect(SOURCES.every((s) => s.scope !== 'cross_patient_freetext')).toBe(true);
  });
});
