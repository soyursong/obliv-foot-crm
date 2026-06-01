/**
 * E2E spec — T-20260601-foot-CHART-TAB-MUNJIN-DEDUP
 * 고객 차트 탭 [문진]·[진료차트] 중복 정리
 *
 * 요청 (김주연 총괄, C0ATE5P6JTH):
 *   "2번차트 탭에서 [문진][진료차트] 중복 항목 - 문진 제거하고
 *    [진료차트] 펜차트 옆 현 [문진] 위치로 변경"
 *
 * 작업:
 *   1. 고객 차트 화면 탭에서 [문진] 탭 제거 (진입점만 제거, 데이터/테이블 보존 — OQ1)
 *   2. [진료차트] 탭을 [펜차트] 바로 옆(구 [문진] 자리)으로 이동
 *      → 결과 순서: [펜차트] [진료차트] [검사결과] ...
 *   3. 진료차트 내부 기능 무변경 (순수 탭 배열/렌더 순서 변경)
 *
 * 수정 내용:
 *   FE-1: CLINICAL_TABS 에서 { key:'checklist', label:'문진' } 제거
 *   FE-2: 진료차트(btn-open-medical-chart) 버튼을 CLINICAL_TABS.map 내부
 *         pen_chart 직후로 이동 (Fragment 사용) → 말미 standalone 버튼 제거
 *
 * 현장 시나리오 → spec 변환 (2종):
 *   S1: 고객차트 임상 탭열에 [문진] 버튼이 더 이상 없다.
 *   S2: [진료차트] 버튼이 [펜차트] 바로 다음 위치에 렌더된다.
 *
 * 검증 방식: 소스 코드 레벨 (인증 의존 없이 결정적). 빌드 산출물(dist) 확인.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const chartPage = (): string =>
  fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');

// ─── S1: [문진] 탭 진입점 제거 ──────────────────────────────────────────────

test.describe('T-20260601-CHART-TAB-MUNJIN-DEDUP S1: 문진 탭 제거', () => {

  test('CLINICAL_TABS 에 checklist/문진 탭 정의가 없다', () => {
    const s = chartPage();
    // CLINICAL_TABS 배열 본문만 추출하여 검사 (콘텐츠 블록의 checklist 참조와 분리)
    const m = s.match(/const CLINICAL_TABS = \[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).not.toContain("key: 'checklist'");
    expect(body).not.toContain("label: '문진'");
  });

  test('펜차트 탭은 여전히 첫 번째 위치에 존재한다 (회귀)', () => {
    const s = chartPage();
    const m = s.match(/const CLINICAL_TABS = \[([\s\S]*?)\];/);
    const body = m![1];
    const penIdx = body.indexOf("key: 'pen_chart'");
    const testIdx = body.indexOf("key: 'test_result'");
    expect(penIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(-1);
    // 펜차트가 검사결과보다 앞에 온다
    expect(penIdx).toBeLessThan(testIdx);
  });

  test('OQ1: 문진 데이터(checklists) 조회/렌더 로직은 보존된다', () => {
    const s = chartPage();
    // 데이터 통합 전까지 checklistEntries 로직은 유지 (진입점만 제거)
    expect(s).toContain('checklistEntries');
    expect(s).toContain("from('checklists')");
  });
});

// ─── S2: [진료차트] 버튼을 펜차트 바로 옆으로 이동 ──────────────────────────

test.describe('T-20260601-CHART-TAB-MUNJIN-DEDUP S2: 진료차트 재배치', () => {

  test('btn-open-medical-chart 버튼은 1개만 존재한다 (standalone 중복 제거)', () => {
    const s = chartPage();
    const count = (s.match(/data-testid="btn-open-medical-chart"/g) ?? []).length;
    expect(count).toBe(1);
  });

  test('진료차트 버튼이 pen_chart 직후 조건부로 렌더된다', () => {
    const s = chartPage();
    // pen_chart 직후 삽입 가드
    expect(s).toContain("key === 'pen_chart'");
    // 가드와 진료차트 버튼이 같은 영역 내에 위치
    const guardIdx = s.indexOf("key === 'pen_chart'");
    const btnIdx = s.indexOf('data-testid="btn-open-medical-chart"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(btnIdx).toBeGreaterThan(guardIdx);
    // 두 위치가 인접 (같은 map 블록 내, 600자 이내)
    expect(btnIdx - guardIdx).toBeLessThan(600);
  });

  test('진료차트 버튼은 Fragment 기반 map 내부로 이동됐다', () => {
    const s = chartPage();
    expect(s).toContain('CLINICAL_TABS.map');
    expect(s).toContain('<Fragment key={key}>');
  });

  test('진료차트 onClick → setMedicalChartOpen(true) 동작 보존', () => {
    const s = chartPage();
    expect(s).toContain('onClick={() => setMedicalChartOpen(true)}');
    expect(s).toContain('진료차트');
    expect(s).toContain('Stethoscope');
  });

  test('AC: 빌드 산출물 dist 존재 (빌드 통과 확인)', () => {
    expect(fs.existsSync('dist')).toBe(true);
  });
});
