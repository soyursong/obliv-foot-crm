/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-EXTRACT-INDIVIDUAL-MD-BATCH
 *
 * 진료대시보드>경과분석 탭 — 기존 [ZIP 다운로드] 옆에 [개별 저장] 버튼 additive.
 *   선택 전원의 경과분석 .md 를 ZIP 묶음 없이 각 파일 개별 다운로드(downloadMd 순차 트리거).
 *   추출/조립 로직·파일명 규칙({차트번호}_{이름}.md)·게이트(canExtractProgress) = 기존 재사용(재가공 금지).
 *   부모 PHASE1(T-20260821) 위 additive. read-only(db_change=false). 새 npm 미추가(ZIP 불필요).
 *
 * 대상(순수 함수) — auth/page/server 미사용 → playwright.config 'unit' 프로젝트:
 *   src/lib/progressAnalysisMd.ts : buildProgressAnalysisMd / progressAnalysisMdBasename
 *
 * AC(현장 시나리오 매핑):
 *   시나리오1(전체선택 개별 저장): 선택 전원 → 1인당 .md 1개, 파일명 {차트}_{이름}, 내용=기존 추출과 동일.
 *   시나리오2(부분선택 개별 저장): 선택 인원 수만큼만 basename 산출.
 *   시나리오3(엣지): 빈 선택 → 산출 0개(호출부 안내 후 미발생) / 동일 {차트}_{이름} 충돌 시 _n 접미로 파일 유실 방지.
 *
 * 실기기 순차 다운로드/브라우저 다중 다운로드 프롬프트/토스트/버튼 노출 = supervisor 갤탭 field-soak(browser_verify).
 */
import { test, expect } from '@playwright/test';
import {
  buildProgressAnalysisMd,
  progressAnalysisMdBasename,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';

const CUST_A = '11111111-2222-3333-4444-555555555555';
const CUST_B = '22222222-3333-4444-5555-666666666666';
const CUST_C = '33333333-4444-5555-6666-777777777777';

function fullEnvelopeFor(custId: string): ProgressAnalysisEnvelope {
  return {
    boilerSet: new Set(),
    milestonesByCust: new Map([[custId, [{ anticipated: 6, used: 5, total: 12 }]]]),
    visitCountByCust: new Map([[custId, 5]]),
    nextResvByCust: new Map([
      [custId, { reservation_date: '2026-08-25', reservation_time: '14:30', registrar_name: '김코디' }],
    ]),
    memosByCust: new Map([
      [
        custId,
        [
          {
            content: '좌측 엄지 호전. 부기 감소.',
            created_at: '2026-08-01T10:00:00Z',
            created_by: null,
            created_by_name: '박치료',
          },
        ],
      ],
    ]),
    rxByCust: new Map(),
    hqByCust: new Map(),
    firstVisitByCust: new Map(),
    consultByCust: new Map(),
    chartByCust: new Map(),
  };
}

/**
 * 컴포넌트 handleIndividualDownload 의 파일명 dedupe 알고리즘 미러(= handleZipDownload 와 동일 규칙).
 *   개별 저장은 선택 전원을 고객 dedupe 후 순회하며 progressAnalysisMdBasename 산출, 동일 basename 충돌 시 _n 접미.
 *   downloadMd 는 basename 에 .md 를 자동 부착하므로 여기서는 basename(확장자 제외) 배열을 검증.
 */
function individualBasenames(patients: ProgressAnalysisPatient[]): string[] {
  const usedNames = new Map<string, number>();
  const out: string[] = [];
  for (const p of patients) {
    let base = progressAnalysisMdBasename(p);
    if (usedNames.has(base)) {
      const n = (usedNames.get(base) ?? 1) + 1;
      usedNames.set(base, n);
      base = `${base}_${n}`;
    } else {
      usedNames.set(base, 1);
    }
    out.push(base);
  }
  return out;
}

test.describe('T-20260822 EXTRACT-INDIVIDUAL — 시나리오1(전체선택 개별 저장)', () => {
  test('AC1-1: 선택 전원 → 1인당 .md basename 1개(ZIP 아님, 개별 파일 단위)', () => {
    const patients: ProgressAnalysisPatient[] = [
      { id: CUST_A, name: '홍길동', chart_number: '404658' },
      { id: CUST_B, name: '김철수', chart_number: '404659' },
      { id: CUST_C, name: '이영희', chart_number: '404660' },
    ];
    const names = individualBasenames(patients);
    expect(names).toHaveLength(3); // 인원 수 == 개별 파일 수
    expect(names).toEqual(['404658_홍길동', '404659_김철수', '404660_이영희']);
  });

  test('AC1-2: 파일명 규칙 = {차트번호}_{이름} (기존 개별/ZIP 다운로드와 동일, 신규 규칙 없음)', () => {
    expect(progressAnalysisMdBasename({ id: CUST_A, name: '홍길동', chart_number: '404658' })).toBe(
      '404658_홍길동',
    );
  });

  test('AC1-3: 내용 = 기존 추출 로직 그대로(재가공 없음)', () => {
    const patient: ProgressAnalysisPatient = { id: CUST_A, name: '홍길동', chart_number: '404658' };
    const md = buildProgressAnalysisMd(patient, fullEnvelopeFor(CUST_A));
    expect(md).toContain('# 경과분석 자료 — 홍길동');
    expect(md).toContain('- 차트번호: 404658');
    expect(md).toContain('좌측 엄지 호전. 부기 감소.'); // 원문 반영
  });
});

test.describe('T-20260822 EXTRACT-INDIVIDUAL — 시나리오2(부분선택)', () => {
  test('AC2-1: 부분선택 인원 수만큼만 basename 산출', () => {
    const patients: ProgressAnalysisPatient[] = [
      { id: CUST_A, name: '홍길동', chart_number: '404658' },
      { id: CUST_B, name: '김철수', chart_number: '404659' },
    ];
    expect(individualBasenames(patients)).toEqual(['404658_홍길동', '404659_김철수']);
  });
});

test.describe('T-20260822 EXTRACT-INDIVIDUAL — 시나리오3(엣지)', () => {
  test('AC3-1: 빈 선택 → basename 0개(호출부 "선택된 환자가 없습니다" 안내 후 다운로드 미발생)', () => {
    expect(individualBasenames([])).toEqual([]);
  });

  test('AC3-2: 동일 {차트}_{이름} 충돌 시 _n 접미 — 개별 파일 덮어쓰기/유실 방지', () => {
    const patients: ProgressAnalysisPatient[] = [
      { id: CUST_A, name: '홍길동', chart_number: '404658' },
      { id: CUST_B, name: '홍길동', chart_number: '404658' }, // 동명이인·동일차트 표기 충돌
      { id: CUST_C, name: '홍길동', chart_number: '404658' },
    ];
    const names = individualBasenames(patients);
    expect(names).toEqual(['404658_홍길동', '404658_홍길동_2', '404658_홍길동_3']);
    // 모두 고유 → 순차 다운로드 시 서로 덮어쓰지 않음
    expect(new Set(names).size).toBe(3);
  });

  test('AC3-3: 차트번호 없으면 id-앞8자리 폴백(기존 규칙 상속)', () => {
    expect(progressAnalysisMdBasename({ id: CUST_A, name: '무명', chart_number: null })).toBe(
      `id-${CUST_A.slice(0, 8)}_무명`,
    );
  });
});
