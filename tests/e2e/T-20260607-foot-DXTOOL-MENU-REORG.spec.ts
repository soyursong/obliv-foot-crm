/**
 * E2E spec — T-20260607-foot-DXTOOL-MENU-REORG (문지은 대표원장 C0ATE5P6JTH)
 *
 * Stage A (FE 무DB): 진료관리(ClinicManagement) 탭 3행 재배치 — flex-wrap basis-full 빈 div 로 행 경계 명시 강제.
 *   행1: 상병명 관리 → 처방세트(=기존 drug_folders 리네임) → 빠른처방 버튼 → 금기증 관리
 *   행2: 상용구 → 슈퍼상용구 → 서류 템플릿
 *   행3: 진료세트 → 수가세트 → 경과분석 플랜
 * Stage B (FE 무DB): drug_folders 탭 라벨 '약품 폴더' → '처방세트' (data-testid=tab-drug-folders 보존).
 *   ↳ 기존 '처방세트'(prescriptions=묶음처방) 탭은 라벨 충돌 회피 위해 '묶음처방'으로 분리 표기(전환기, Stage C 후 제거 예정).
 *
 * 본 spec 은 구조 불변식을 정본 소스 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀) + 권한자 환경에서 브라우저 렌더 확인.
 * Stage C(DB 이관)는 별도 — 본 spec 범위 아님.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';

// ── Stage A/B 구조 불변식 (소스 정본) ────────────────────────────────────────────
test.describe('DXTOOL-MENU-REORG — 소스 구조 불변식', () => {
  const src = read(CLINIC_MGMT);

  test('Stage B: drug_folders 탭 라벨이 "처방세트" + data-testid=tab-drug-folders 보존', () => {
    // drug_folders 트리거 블록에 라벨 '처방세트' 와 testid 가 함께 존재
    const block = src.match(/value="drug_folders"[\s\S]{0,200}?<\/TabsTrigger>/);
    expect(block, 'drug_folders TabsTrigger 블록').not.toBeNull();
    expect(block![0]).toContain('data-testid="tab-drug-folders"');
    expect(block![0]).toContain('처방세트');
    expect(block![0]).not.toContain('약품 폴더');
  });

  test('Stage B: 기존 prescriptions 탭은 "묶음처방"으로 분리 표기(value=prescriptions 유지)', () => {
    const block = src.match(/value="prescriptions"[\s\S]{0,200}?<\/TabsTrigger>/);
    expect(block, 'prescriptions TabsTrigger 블록').not.toBeNull();
    expect(block![0]).toContain('묶음처방');
    // 충돌 방지: prescriptions 트리거 라벨이 '처방세트' 가 아니어야 함
    expect(block![0]).not.toMatch(/>\s*처방세트\s*</);
  });

  test('Stage A: 3개의 행 경계(basis-full 강제 줄바꿈) div 가 존재', () => {
    const breaks = src.match(/basis-full h-0/g) ?? [];
    expect(breaks.length).toBe(3);
  });

  test('Stage A: 행1 순서 = 상병명 관리 → 처방세트(drug_folders) → 빠른처방 → 금기증', () => {
    const iDiag = src.indexOf('value="diagnosis_names"');
    const iDrug = src.indexOf('value="drug_folders"');
    const iQuick = src.indexOf('value="quick_rx"');
    const iContra = src.indexOf('value="contraindications"');
    const iBreak1 = src.indexOf('basis-full h-0');
    [iDiag, iDrug, iQuick, iContra, iBreak1].forEach((i) => expect(i).toBeGreaterThan(-1));
    // 행1 4개 트리거가 모두 첫 행 경계(div) 이전에 위치
    expect(iDiag).toBeLessThan(iDrug);
    expect(iDrug).toBeLessThan(iQuick);
    expect(iQuick).toBeLessThan(iContra);
    expect(iContra).toBeLessThan(iBreak1);
  });

  test('Stage A: 행2(상용구·슈퍼상용구·서류) 가 행1 경계 뒤 / 행3 경계 앞', () => {
    const breaks = [...src.matchAll(/basis-full h-0/g)].map((m) => m.index!);
    const iPhrases = src.indexOf('value="phrases"');
    const iSuper = src.indexOf('value="super_phrases"');
    const iDocs = src.indexOf('value="documents"');
    expect(iPhrases).toBeGreaterThan(breaks[0]);
    expect(iDocs).toBeLessThan(breaks[1]);
    expect(iPhrases).toBeLessThan(iSuper);
    expect(iSuper).toBeLessThan(iDocs);
  });

  test('Stage A: 행3(진료세트·수가세트·경과분석) 가 행2 경계 뒤 / 행3 경계 앞', () => {
    const breaks = [...src.matchAll(/basis-full h-0/g)].map((m) => m.index!);
    const iTreat = src.indexOf('value="treatment_sets"');
    const iFee = src.indexOf('value="fee_set_templates"');
    const iProg = src.indexOf('value="progress_plans"');
    expect(iTreat).toBeGreaterThan(breaks[1]);
    expect(iProg).toBeLessThan(breaks[2]);
    expect(iTreat).toBeLessThan(iFee);
    expect(iFee).toBeLessThan(iProg);
  });
});

// ── 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 skip) ──────────────────────────
test('렌더: /clinic-management 진입 시 처방세트 탭(=drug_folders) + 묶음처방 탭 동시 노출', async ({ page }) => {
  await page.goto('/clinic-management');
  const drugTab = page.getByTestId('tab-drug-folders');
  if ((await drugTab.count()) === 0) {
    test.skip(true, '현재 로그인 역할은 진료관리 비대상(admin/manager/director 외) — 권한 게이트 정상');
    return;
  }
  // Stage B: drug_folders 탭이 '처방세트' 라벨로 노출
  await expect(drugTab).toBeVisible({ timeout: 10_000 });
  await expect(drugTab).toContainText('처방세트');
  // 전환기 묶음처방(prescriptions) 탭도 함께 노출 (충돌 없이 분리)
  await expect(page.getByTestId('tab-prescription-sets-legacy')).toContainText('묶음처방');
  // 클릭 시 약품 폴더 트리(드러그 폴더 관리 화면) 렌더 — value 매핑 무회귀
  await drugTab.click();
  await expect(page.getByTestId('drug-folder-admin-tree')).toBeVisible({ timeout: 10_000 });
});
