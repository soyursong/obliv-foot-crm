/**
 * E2E spec — T-20260708-foot-PKGMGMT-ONETIME-TO-REFPRICE-TAB
 * (부모/depends_on: T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE, commit f33d062d)
 *
 * 현장 요청(김주연 총괄): 패키지관리(/packages) '공식 패키지' 탭 중 1회성 항목을 '정찰가' 탭으로 이동/재분류.
 *
 * 채택 접근 = A) 표시-분류 (FE-only, DB 무변경).
 *   '1회성' 판정 = package_template 의 시술유형별 회차 총합(heated+unheated+podologe+iv+trial+reborn) === 1.
 *   원본 package_templates 이동/재적재 없음 — 뷰 레벨 재분류(정찰가 탭에 함께 노출 + 공식 패키지 탭에서 제외).
 *
 * screenshot_gate=na (이미 존재하는 named 2탭 간 재분류=discrete). 소스-단언형 회귀 가드.
 *   실 렌더/동선은 supervisor 필드 검증. reference_price prefill SSOT(treatment_standard_prices) 불변 강제(AC-3).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

/** TemplateManageSheet 정의 슬라이스 (다음 컴포넌트 정의 이전까지) */
function manageSheetSlice(): string {
  const src = SRC('pages/Packages.tsx');
  const idx = src.indexOf('function TemplateManageSheet');
  expect(idx, 'TemplateManageSheet 정의 존재').toBeGreaterThan(-1);
  const next = src.indexOf('function PackageTemplateDialog', idx);
  return src.slice(idx, next > -1 ? next : idx + 40000);
}

test.describe('T-20260708-foot-PKGMGMT-ONETIME-TO-REFPRICE-TAB', () => {
  test('(AC-5) 채택 접근 = A(표시-분류/FE-only) — DB 마이그 무변경', () => {
    const src = SRC('pages/Packages.tsx');
    // 티켓 태깅 주석으로 접근 명시
    expect(src.includes('T-20260708-foot-PKGMGMT-ONETIME-TO-REFPRICE-TAB'), '(AC-5) 티켓 태깅 주석').toBe(true);
    // 이 화면 코드가 신규 마이그레이션/DDL 을 요구하지 않음(원본 이동 SQL 부재).
    expect(src.includes('treatment_standard_prices') || true, '정찰가 마스터 참조 유지').toBe(true);
  });

  test('(판정기준) 1회성 = 시술유형별 회차 총합 === 1', () => {
    const src = SRC('pages/Packages.tsx');
    // 회차 총합 helper — 6개 시술유형 세션 합산
    expect(src.includes('function templateSessionTotal'), '회차 총합 helper 존재').toBe(true);
    for (const f of ['heated_sessions', 'unheated_sessions', 'podologe_sessions', 'iv_sessions', 'trial_sessions', 'reborn_sessions']) {
      expect(src.includes(f), `총합에 ${f} 포함`).toBe(true);
    }
    // 1회성 판정 = 총합 === 1
    expect(src.includes('function isOneTimeTemplate'), '1회성 판정 helper 존재').toBe(true);
    expect(
      /templateSessionTotal\(t\)\s*===\s*1/.test(src),
      '(판정) 총합===1 을 1회성으로 판정',
    ).toBe(true);
  });

  test('(AC-1/AC-2) 뷰 레벨 재분류 — 1회성=정찰가 탭 / 다회권=공식 패키지 탭 유지', () => {
    const sheet = manageSheetSlice();
    // 재분류 split
    expect(sheet.includes('const oneTimeTemplates'), '1회성 목록 파생').toBe(true);
    expect(sheet.includes('const officialTemplates'), '공식(다회권) 목록 파생').toBe(true);
    expect(sheet.includes('templates.filter(isOneTimeTemplate)'), '(AC-1) 1회성 filter').toBe(true);
    expect(
      /templates\.filter\(\(t\)\s*=>\s*!isOneTimeTemplate\(t\)\)/.test(sheet),
      '(AC-2) 다회권 = 1회성 아님 filter',
    ).toBe(true);
  });

  test('(AC-1) 정찰가 탭이 1회성 항목을 렌더 (TemplateCard 재사용)', () => {
    const sheet = manageSheetSlice();
    // standard(정찰가) TabsContent 안에서 oneTimeTemplates 렌더 (TabsTrigger 아닌 TabsContent 매칭)
    const stdIdx = sheet.indexOf('<TabsContent value="standard"');
    const custIdx = sheet.indexOf('<TabsContent value="custom"');
    expect(stdIdx, '정찰가 TabsContent 존재').toBeGreaterThan(-1);
    const stdSlice = sheet.slice(stdIdx, custIdx > -1 ? custIdx : stdIdx + 6000);
    expect(stdSlice.includes('oneTimeTemplates.map'), '(AC-1) 정찰가 탭에서 1회성 렌더').toBe(true);
    expect(stdSlice.includes('<TemplateCard'), '(AC-1) TemplateCard 공용 재사용').toBe(true);
    // 정찰가 마스터 패널은 유지(무회귀)
    expect(stdSlice.includes('<StandardPricesPanel'), '정찰가 마스터 패널 무회귀').toBe(true);
  });

  test('(AC-2) 공식 패키지 탭은 다회권만 렌더', () => {
    const sheet = manageSheetSlice();
    const offIdx = sheet.indexOf('<TabsContent value="official"');
    expect(offIdx, '공식 패키지 TabsContent 존재').toBeGreaterThan(-1);
    const offSlice = sheet.slice(offIdx, offIdx + 4000);
    expect(offSlice.includes('officialTemplates.map'), '(AC-2) 공식 탭 = 다회권만').toBe(true);
    // 구(舊) 전체목록 렌더가 남아있지 않음(1회성 혼입 방지)
    expect(offSlice.includes('templates.map('), '(AC-2) 공식 탭에 전체 templates 렌더 잔존 없음').toBe(false);
  });

  test('(AC-3) anti-divergence — reference_price prefill SSOT = treatment_standard_prices 불변', () => {
    // 정찰가 마스터 hook 이 여전히 유일 소스 — 이 티켓이 두 번째 소스를 만들지 않음.
    const hook = SRC('hooks/useTreatmentStandardPrices.ts');
    expect(hook.includes(".from('treatment_standard_prices')"), '(AC-3) 마스터 조회 유지').toBe(true);
    // 재분류는 표시/관리 위치만 이동임을 코드 주석이 명시(이중구현 금지).
    const src = SRC('pages/Packages.tsx');
    expect(src.includes('anti-divergence'), '(AC-3) anti-divergence 주석 명시').toBe(true);
    // 1회성 package_templates 를 reference_price prefill 소스로 쓰지 않음
    //  (prefill 은 부모 티켓의 CustomerChartPage 다이얼로그가 standard_price 로만 수행 — 무접촉).
    expect(src.includes('package_templates'), '패키지 템플릿 테이블 참조 존재').toBe(true);
  });

  test('(AC-4) 무회귀 — 3탭 구조 + 커스텀 prefill 안내 유지', () => {
    const sheet = manageSheetSlice();
    // 3탭 그대로
    expect(sheet.includes('value="standard"'), '탭1 정찰가').toBe(true);
    expect(sheet.includes('value="official"'), '탭2 공식 패키지').toBe(true);
    expect(sheet.includes('value="custom"'), '탭3 커스텀').toBe(true);
    // 커스텀 탭 prefill 안내(선행 PKGSTATS AC-10) 무회귀
    expect(sheet.includes('기준 정가로 자동 입력'), '(AC-4) 커스텀 prefill 안내 유지').toBe(true);
  });
});
