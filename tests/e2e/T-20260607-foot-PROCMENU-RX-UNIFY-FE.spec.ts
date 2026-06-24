/**
 * E2E spec — T-20260607-foot-PROCMENU-RX-UNIFY (item2 + item3, FE only · DB無)
 *
 * 대표원장(문지은) spec 직접확정 (2026-06-13):
 *   "기존 처방세트에 묶음처방 약들 다 가져오기 / 묶음처방은 처방세트 옆에 별도로 만들기 / 빠른처방버튼 → 빠른처방 으로 바꾸기"
 *
 * 본 spec 범위 = item2 + item3 (FE only). item1(묶음약→처방세트 backfill)은 supervisor 마이그게이트 별도 트랙 — 본 spec 비대상.
 *
 *   item2: 묶음처방(prescription_sets, value=prescriptions)을 '처방세트'(drug_folders) 바로 옆(행1)에 병렬 노출.
 *          dissolve 금지 — prescription_sets 보존, 두 탭 직교 공존(처방세트 | 묶음처방).
 *   item3: '빠른처방 버튼' 탭 라벨 → '빠른처방'.
 *
 * 구조 불변식을 정본 소스 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀) + 권한자 환경에서 브라우저 렌더 확인.
 * 진료 진입경로(QuickRxBar/prescriptionGate) 무회귀는 별도 RX 스펙군이 커버 — 본 spec 은 메뉴 카피/배치만.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';

test.describe('PROCMENU-RX-UNIFY item2/3 — 소스 구조 불변식', () => {
  const src = read(CLINIC_MGMT);

  test('item2: 묶음처방(prescriptions) 탭이 처방세트(drug_folders) 바로 옆 — 사이에 다른 트리거 없음', () => {
    const iDrug = src.indexOf('value="drug_folders"');
    const iRxSet = src.indexOf('value="prescriptions"');
    expect(iDrug).toBeGreaterThan(-1);
    expect(iRxSet).toBeGreaterThan(-1);
    expect(iDrug).toBeLessThan(iRxSet);
    // 처방세트와 묶음처방 사이 구간에 다른 TabsTrigger value= 가 끼지 않음 ("바로 옆")
    const between = src.slice(iDrug, iRxSet);
    expect(between).not.toMatch(/value="(?!drug_folders)[a-z_]+"/);
  });

  test('item2: 묶음처방 = prescription_sets 보존(dissolve 금지) — value=prescriptions 트리거+콘텐츠 공존', () => {
    expect(src).toContain('value="prescriptions"');
    expect(src).toContain('<PrescriptionSetsTab />');
    // 묶음처방 탭이 행1(첫 행 경계 이전)에 위치
    const iRxSet = src.indexOf('value="prescriptions"');
    const iBreak1 = src.indexOf('basis-full h-0');
    expect(iBreak1).toBeGreaterThan(-1);
    expect(iRxSet).toBeLessThan(iBreak1);
  });

  test('item2: 처방세트(drug_folders)·묶음처방(prescriptions) 두 탭 라벨이 서로 구분 — 충돌 없음', () => {
    const drugBlock = src.match(/value="drug_folders"[\s\S]{0,200}?<\/TabsTrigger>/);
    const rxBlock = src.match(/value="prescriptions"[\s\S]{0,300}?<\/TabsTrigger>/);
    expect(drugBlock![0]).toContain('처방세트');
    expect(rxBlock![0]).toContain('묶음처방');
    expect(rxBlock![0]).not.toMatch(/>\s*처방세트\s*</);
  });

  // T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL Part F: 빠른처방 전용 서브탭 retire(묶음처방 태그로 일원화).
  //   구 item3(빠른처방 탭 라벨 검증)은 서브탭 제거로 무효 → 부재 락인으로 전환(문지은 대표원장 MSG-ol3p).
  test('item3 [Part F retire]: 빠른처방 전용 서브탭(quick_rx) 제거됨', () => {
    expect(src).not.toContain('value="quick_rx"');
    expect(src).not.toContain('data-testid="tab-quick-rx"');
    expect(src).not.toContain('<QuickRxButtonsTab');
  });
});

// ── 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 skip) ──────────────────────────
test('렌더: /clinic-management — 처방세트 옆 묶음처방 병렬 노출 + 빠른처방 서브탭 부재(Part F)', async ({ page }) => {
  await page.goto('/clinic-management');
  const drugTab = page.getByTestId('tab-drug-folders');
  if ((await drugTab.count()) === 0) {
    test.skip(true, '현재 로그인 역할은 진료관리 비대상(admin/manager/director 외) — 권한 게이트 정상');
    return;
  }
  // item2: 처방세트 + 묶음처방 두 탭 동시 노출(병렬 공존)
  await expect(drugTab).toContainText('처방세트');
  await expect(page.getByTestId('tab-prescription-sets-legacy')).toContainText('묶음처방');
  // Part F: 빠른처방 전용 서브탭 retire — DOM 에서 부재(묶음처방 태그로 일원화)
  await expect(page.getByTestId('tab-quick-rx')).toHaveCount(0);
  // 무회귀: 묶음처방 탭 클릭 시 prescription_sets 관리 화면(PrescriptionSetsTab) 렌더
  await page.getByTestId('tab-prescription-sets-legacy').click();
  await expect(page.getByText('묶음처방', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});
