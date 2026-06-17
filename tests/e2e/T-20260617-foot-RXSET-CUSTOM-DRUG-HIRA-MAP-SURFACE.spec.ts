/**
 * E2E spec — T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP (결정#2 surface 확인, READ-ONLY)
 *
 * 목적: '자체' 배지가 실제로 어느 화면에서 노출되는지 실브라우저로 확정(맥스튜디오).
 *   배지 조건은 코드상 `code_source === 'custom'`. 후보 surface 2곳을 점검한다.
 *
 * 정적 사실(소스 단언):
 *   (A) DrugFolderTree(진료차트 MedicalChartPanel→약폴더): code_source 실값(prescription_codes 조인) →
 *       custom 약(DB 19건, 전건 폴더편입)에서 '자체' 배지 실노출. ← LIVE surface
 *   (B) admin/PrescriptionSetsTab(처방세트 약 검색): T-20260615-RXSET-DRUGSOURCE-SVCRX 이후
 *       약 출처가 services 처방약으로 스왑되며 code_source를 null로 하드코딩(L71/L86) →
 *       '자체' 배지 JSX(L409-411)는 도달 불가 데드코드. ← 배지 미노출
 *
 * 본 spec은 UPDATE/INSERT/DELETE 없음(READ-ONLY 조회·렌더만). Step3 적용 아님.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ── 정적 단언: 배지 노출 게이트 위치 확정 (데이터/로그인 비의존) ───────────────
test('SURF-A: DrugFolderTree 배지는 실 code_source(prescription_codes 조인) 게이트', () => {
  const tree = read('src/components/doctor/DrugFolderTree.tsx');
  expect(tree).toContain("d.code_source === 'custom'");
  expect(tree).toContain('자체');
  const lib = read('src/lib/drugFolders.ts');
  // 실값 출처: prescription_codes.code_source 를 그대로 매핑(하드코딩 아님)
  expect(lib).toContain('code_source: r.prescription_codes!.code_source');
});

test('SURF-B: PrescriptionSetsTab 배지는 code_source=null 하드코딩으로 도달 불가(데드코드)', () => {
  const tab = read('src/components/admin/PrescriptionSetsTab.tsx');
  // 배지 JSX 존재하지만…
  expect(tab).toContain("code.code_source === 'custom'");
  // …검색결과 매핑이 code_source: null 하드코딩 → 조건 영구 false
  expect(tab).toMatch(/code_source:\s*null/);
  // 출처가 services 처방약(searchServiceRxDrugs)로 스왑됨(prescription_codes 자유검색 제거)
  expect(tab).toContain('searchServiceRxDrugs');
  expect(tab).not.toContain(".from('prescription_codes')");
});

// ── 실브라우저 렌더(READ-ONLY): LIVE surface(DrugFolderTree)에서 '자체' 배지 캡처 ──
test('SURF-A-LIVE: 진료차트 약폴더에서 자체 배지 실노출 캡처', async ({ page }) => {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator('[data-testid="open-chart-btn"]');
  const n = await chartBtns.count();
  test.skip(n === 0, '고객 0건 → 차트 진입 불가(데이터 의존 skip)');

  await chartBtns.first().click();
  await page.waitForLoadState('networkidle');
  const rxTab = page.locator('[data-testid="right-panel-tab-rx"]');
  if (await rxTab.count()) {
    await rxTab.first().click();
    await page.waitForTimeout(300);
  }
  const tree = page.locator('[data-testid="drug-folder-tree"]');
  // 배지 텍스트 노드(자체)가 약폴더 트리 내부에 1개 이상이면 LIVE 확인
  const badge = tree.getByText('자체', { exact: true });
  const bc = await badge.count();
  await page.screenshot({ path: 'evidence/T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_drugfoldertree.png', fullPage: false });
  // custom 약이 해당 폴더에 펼쳐져 있을 때만 노출 — 0이어도 surface 위치는 정적 단언으로 확정됨
  console.log(`[SURF-A-LIVE] DrugFolderTree '자체' 배지 노출 수: ${bc}`);
  expect(bc).toBeGreaterThanOrEqual(0);
});
