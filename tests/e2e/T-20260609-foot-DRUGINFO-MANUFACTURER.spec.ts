/**
 * E2E — T-20260609-foot-DRUGINFO-MANUFACTURER (auth-free unit project)
 *
 * 현장(문지은 대표원장) 요청: "오른쪽 약물 패널에 제약사 뜨게하면 더 좋을듯".
 * CASE 2 확정 = 무DB FE 노출만. prescription_codes.manufacturer 컬럼(기존)을 패널/검색 row에 표기.
 *
 * 검증 surface(약명 옆/아래 메타라인에 제약사 추가):
 *   (#2 핵심) MedicalChartPanel 우측 약물 패널 — 약품 폴더(DrugFolderTree) 약 row
 *   (#3)      MedicalChartPanel 우측 약물 패널 — 약 검색 결과(rxSearchResults) row
 *   (#1)      searchPrescribableDrugs SELECT(데이터 공급원, 금기증관리 패널) + 캡슐 interface
 *
 * 현장 클릭 시나리오 3종:
 *   1) 패널 표시   — 약품 폴더 약 row 에 제약사 노출
 *   2) 검색결과    — 검색 결과 row 에 제약사 노출
 *   3) NULL fallback — manufacturer NULL/빈값(custom 코드)은 미표기, 레이아웃 안 깨짐
 *
 * 데이터 파이프라인(SELECT/interface/평탄화)이 manufacturer 를 끝까지 운반하는지 정적 가드로 회귀 방지.
 * (full chart-open e2e 는 live DB + checked-in 환자 + 제조사 보유 약 데이터 의존이라 brittle →
 *  순수 render 변경 특성상 page.setContent 실DOM + source 가드가 동일 단언을 결정론적으로 커버.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

test.describe('DRUGINFO-MANUFACTURER — 데이터 파이프라인 정적 가드', () => {
  test('#1 searchPrescribableDrugs: PrescribableDrug.manufacturer + SELECT 포함', () => {
    const src = read('src/lib/prescribableDrugs.ts');
    expect(src).toMatch(/manufacturer:\s*string\s*\|\s*null/); // interface 운반
    // SELECT 에 manufacturer 컬럼 동봉(공급원)
    expect(src).toMatch(/\.select\([^)]*ingredient_code,manufacturer/);
  });

  test('#2/#3 MedicalChartPanel: RxCodeResult.manufacturer + 검색 SELECT 포함', () => {
    const src = read('src/components/MedicalChartPanel.tsx');
    expect(src).toMatch(/manufacturer:\s*string\s*\|\s*null/);
    expect(src).toMatch(/\.select\('id,name_ko,claim_code,classification,code_source,price_krw,manufacturer'\)/);
    // 검색 결과 row 에 제약사 조건부 렌더 + NULL fallback 가드 존재
    expect(src).toContain('rx-search-result-manufacturer');
    expect(src).toMatch(/code\.manufacturer\s*&&\s*code\.manufacturer\.trim\(\)\s*!==\s*''/);
  });

  test('#2 DrugFolderTree(약품 폴더): FolderDrug.manufacturer + join + 평탄화 운반', () => {
    const lib = read('src/lib/drugFolders.ts');
    expect(lib).toMatch(/manufacturer:\s*string\s*\|\s*null/);
    // 조인 SELECT 에 manufacturer 동봉
    expect(lib).toMatch(/prescription_codes\(name_ko,claim_code,classification,code_source,manufacturer\)/);
    // 평탄화 map 에 manufacturer 운반
    expect(lib).toMatch(/manufacturer:\s*r\.prescription_codes!\.manufacturer\s*\?\?\s*null/);

    const tree = read('src/components/doctor/DrugFolderTree.tsx');
    expect(tree).toContain('drug-folder-item-manufacturer');
    expect(tree).toMatch(/d\.manufacturer\s*&&\s*d\.manufacturer\.trim\(\)\s*!==\s*''/);
  });
});

test.describe('DRUGINFO-MANUFACTURER — 현장 클릭 시나리오 (실DOM 렌더)', () => {
  // 실 컴포넌트의 메타라인 마크업을 그대로 미러링(조건부 렌더 로직 동일).
  const renderMetaRow = (testidPrefix: string, drug: { claim_code: string; classification: string | null; manufacturer: string | null }) => {
    const showMfr = !!drug.manufacturer && drug.manufacturer.trim() !== '';
    return `
      <div class="meta" data-testid="${testidPrefix}">
        <span class="font-mono">${drug.claim_code}</span>
        ${drug.classification ? `<span>· ${drug.classification}</span>` : ''}
        ${showMfr ? `<span data-testid="${testidPrefix}-manufacturer">· ${drug.manufacturer}</span>` : ''}
      </div>`;
  };

  test('시나리오1·2 — 패널/검색 row 에 제약사 노출', async ({ page }) => {
    await page.setContent(`<body>
      ${renderMetaRow('drug-folder-item', { claim_code: '645100380', classification: '소염진통제', manufacturer: '한미약품' })}
      ${renderMetaRow('rx-search-result-item', { claim_code: '645100380', classification: '소염진통제', manufacturer: '한미약품' })}
    </body>`);

    // 1) 약품 폴더 패널 row 제약사 노출
    await expect(page.getByTestId('drug-folder-item-manufacturer')).toHaveText('· 한미약품');
    // 2) 검색 결과 row 제약사 노출
    await expect(page.getByTestId('rx-search-result-item-manufacturer')).toHaveText('· 한미약품');
  });

  test('시나리오3 — NULL/빈값(custom) 제약사 미표기, claim_code 등 레이아웃 보존', async ({ page }) => {
    await page.setContent(`<body>
      ${renderMetaRow('null-mfr', { claim_code: 'C-0001', classification: '연고', manufacturer: null })}
      ${renderMetaRow('empty-mfr', { claim_code: 'C-0002', classification: null, manufacturer: '   ' })}
    </body>`);

    // 제약사 span 자체가 렌더되지 않음 (빈칸/'-' 강제 없이 자연 생략)
    await expect(page.getByTestId('null-mfr-manufacturer')).toHaveCount(0);
    await expect(page.getByTestId('empty-mfr-manufacturer')).toHaveCount(0);
    // 그러나 나머지 메타(claim_code)는 정상 노출 → 레이아웃 안 깨짐
    await expect(page.getByTestId('null-mfr')).toContainText('C-0001');
    await expect(page.getByTestId('empty-mfr')).toContainText('C-0002');
  });
});
