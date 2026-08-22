/**
 * Unit spec — T-20260823-foot-PROGANALYSIS-MD-ADMIN-GENDER-RRN
 *
 * 경과분석 인풋 .md(progressAnalysisMd.ts) 「## 【행정】 환자 식별 정보」 블록에 ADDITIVE 2줄:
 *   - 성별: 여/남      ← env.genderByCust(customers.gender 'M'/'F' → 남/여)
 *   - 주민번호: 470203 ← env.birth6ByCust(fn_customer_birthdates 서버파생 생년월일 앞6자리 YYMMDD)
 *   삽입 위치 = 성함·차트번호 바로 아래·같은 블록 내부(새 섹션 신설 금지).
 *   주민번호 = 앞6자리(생년월일)만 — 뒷자리·하이픈 절대 미출력(PHI 최소수집). 만나이는 다운스트림 도구 자동계산.
 *   기존 【행정】+【1】~【9】 무접촉(순수 additive)·재가공/이모지 금지.
 *
 * 대상(순수 함수, auth/page/server 미사용 → playwright 'unit' 프로젝트): buildProgressAnalysisMd.
 *
 * AC 매핑:
 *   AC-1: 성함→차트번호→성별→주민번호 순서, 【행정】 블록 내부 삽입(【10】 등 신규섹션 없음).
 *   AC-2: 주민번호 = ^\d{6}$ (뒷자리·하이픈 부재).
 *   AC-3: 성별 = '여'/'남' (M→남, F→여).
 *   AC-4: source 부재(gender/birth6 미보유)면 해당 줄 미표기(fabricate 금지).
 *   AC-5: 기존 섹션(【1】~【9】) 회귀 0 + 하위호환(신규 map 미보유 envelope throw 없이 미표기).
 *
 * 실기기 다운로드/현장 클릭 = doc_only(E2E 면제) — supervisor 갤탭 field-soak(browser_verify).
 */
import { test, expect } from '@playwright/test';
import {
  buildProgressAnalysisMd,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';

const CUST_ID = '11112222-3333-4444-5555-666677778888';
const P: ProgressAnalysisPatient = { id: CUST_ID, name: '한은숙', chart_number: 'F-4817' };

function baseEnvelope(over: Partial<ProgressAnalysisEnvelope> = {}): ProgressAnalysisEnvelope {
  return {
    boilerSet: new Set(),
    milestonesByCust: new Map(),
    visitCountByCust: new Map(),
    nextResvByCust: new Map(),
    memosByCust: new Map(),
    rxByCust: new Map(),
    hqByCust: new Map(),
    firstVisitByCust: new Map(),
    consultByCust: new Map(),
    chartByCust: new Map(),
    visitsByCust: new Map(),
    roomLogsByCheckIn: new Map(),
    activePkgsByCust: new Map(),
    reservationsByCust: new Map(),
    genderByCust: new Map(),
    birth6ByCust: new Map(),
    ...over,
  };
}

test.describe('T-20260823 경과분석 .md 【행정】 성별·주민번호(앞6자리) ADDITIVE', () => {
  test('AC-1/2/3: 성함→차트번호→성별→주민번호 순서 + 주민번호 6자리(뒷자리·하이픈 없음) + 성별 여/남', () => {
    const env = baseEnvelope({
      genderByCust: new Map([[CUST_ID, 'F']]),
      birth6ByCust: new Map([[CUST_ID, '470203']]),
    });
    const md = buildProgressAnalysisMd(P, env);

    // 【행정】 블록 존재 + 4줄
    expect(md).toContain('## 【행정】 환자 식별 정보');
    expect(md).toContain('- 성함: 한은숙');
    expect(md).toContain('- 차트번호: F-4817');
    expect(md).toContain('- 성별: 여'); // F → 여
    expect(md).toContain('- 주민번호: 470203');

    // 순서: 성함 → 차트번호 → 성별 → 주민번호
    const iName = md.indexOf('- 성함: 한은숙');
    const iChart = md.indexOf('- 차트번호: F-4817');
    const iGender = md.indexOf('- 성별: 여');
    const iRrn = md.indexOf('- 주민번호: 470203');
    expect(iName).toBeGreaterThan(-1);
    expect(iChart).toBeGreaterThan(iName);
    expect(iGender).toBeGreaterThan(iChart);
    expect(iRrn).toBeGreaterThan(iGender);

    // AC-2: 주민번호 값 = 정확히 6자리(뒷자리·하이픈 없음)
    const m = md.match(/- 주민번호: (\S+)/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/^\d{6}$/);
    expect(md).not.toContain('470203-'); // 하이픈+뒷자리 금지
    expect(md).not.toContain('- 주민번호: 470203-');

    // AC-1: 새 섹션(【10】 등) 신설 금지
    expect(md).not.toContain('【10】');
  });

  test('AC-3: 성별 M → 남', () => {
    const env = baseEnvelope({
      genderByCust: new Map([[CUST_ID, 'M']]),
      birth6ByCust: new Map([[CUST_ID, '881225']]),
    });
    const md = buildProgressAnalysisMd(P, env);
    expect(md).toContain('- 성별: 남');
    expect(md).toContain('- 주민번호: 881225');
  });

  test('AC-4: source 부재(gender/birth6 없음) → 해당 줄 미표기(fabricate 금지)', () => {
    const env = baseEnvelope(); // gender/birth6 map 비어있음
    const md = buildProgressAnalysisMd(P, env);
    // 성함·차트번호는 그대로, 성별·주민번호 줄은 미표기
    expect(md).toContain('- 성함: 한은숙');
    expect(md).toContain('- 차트번호: F-4817');
    expect(md).not.toContain('- 성별:');
    expect(md).not.toContain('- 주민번호:');
  });

  test('AC-4: 성별만 있고 생년월일 없음 → 성별만 표기(주민번호 미표기)', () => {
    const env = baseEnvelope({
      genderByCust: new Map([[CUST_ID, 'F']]),
      // birth6 없음
    });
    const md = buildProgressAnalysisMd(P, env);
    expect(md).toContain('- 성별: 여');
    expect(md).not.toContain('- 주민번호:');
  });

  test('AC-3 엣지: 매핑 불가 성별값(외국인/공란)은 미표기(추측 금지)', () => {
    const env = baseEnvelope({
      genderByCust: new Map([[CUST_ID, 'X']]), // 매핑 불가
      birth6ByCust: new Map([[CUST_ID, '470203']]),
    });
    const md = buildProgressAnalysisMd(P, env);
    expect(md).not.toContain('- 성별:');
    expect(md).toContain('- 주민번호: 470203');
  });

  test('AC-5: 기존 섹션(【1】~【9】) 회귀 0 + 하위호환(신규 map 미보유 envelope throw 없이 미표기)', () => {
    const legacy = baseEnvelope();
    delete (legacy as Record<string, unknown>).genderByCust;
    delete (legacy as Record<string, unknown>).birth6ByCust;
    let md = '';
    expect(() => {
      md = buildProgressAnalysisMd(P, legacy);
    }).not.toThrow();
    // 기존 【행정】 + 1~9 섹션 헤더 그대로
    expect(md).toContain('## 【행정】 환자 식별 정보');
    expect(md).toContain('### 6배수 예정 회차 · 예약일');
    expect(md).toContain('# 【1】 치료메모');
    expect(md).toContain('# 【5】 임상 유의미 텍스트');
    expect(md).toContain('# 【6】 진료내역');
    expect(md).toContain('# 【7】 동선 로그');
    expect(md).toContain('# 【8】 활성 패키지');
    expect(md).toContain('# 【9】 예약내역');
    // map 부재 → 성별·주민번호 미표기(throw 없음)
    expect(md).not.toContain('- 성별:');
    expect(md).not.toContain('- 주민번호:');
  });
});
