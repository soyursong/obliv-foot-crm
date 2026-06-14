/**
 * E2E spec — T-20260607-foot-DXTOOL-MENU-REORG (문지은 대표원장 C0ATE5P6JTH)
 *
 * Stage A (FE 무DB): 진료관리(ClinicManagement) 탭 2행 재배치 — flex-wrap basis-full 빈 div 로 행 경계 명시 강제.
 *   행1: 상병명 관리 → 묶음상병 → 처방세트(=기존 drug_folders 리네임) → 묶음처방 → 빠른처방 → 금기증 관리 → 급여여부 관리
 *   행2: 상용구 → 슈퍼상용구 → 서류 템플릿
 *   행3: 진료세트 → 수가세트 → 경과분석 플랜
 *   ※ T-20260607-foot-PROCMENU-RX-UNIFY item2(2026-06-13 문지은 대표원장 "묶음처방은 처방세트 옆에 별도로 만들기"):
 *     묶음처방 탭을 맨 끝 별도 행 → '처방세트' 바로 옆(행1)으로 이동. 행 경계 div 3 → 2.
 *   ※ item3(동): '빠른처방 버튼' 탭 라벨 → '빠른처방'.
 * Stage B (FE 무DB): drug_folders 탭 라벨 '약품 폴더' → '처방세트' (data-testid=tab-drug-folders 보존).
 *   ↳ prescription_sets 탭은 '묶음처방'으로 분리 표기. 영구 보존(별도 유지) — 2026-06-08 문지은 대표원장 최종결정.
 *
 * Stage C (그라운딩 결론, FE 무DB): prescription_sets→folder 대량이관 **없음**(가설 A=data-safe 확정).
 *   근거: 키공간 SERIAL(prescription_sets) ≠ UUID(prescription_codes) / posology(items JSONB) 슬롯 부재 /
 *   묶음처방(함께 처방하는 약 묶음) ≠ 폴더 속 개별 약. '처방세트'(drug_folders) 와 '묶음처방'(prescription_sets) 영구 직교 공존.
 *   posology 손실 0. populate 마이그도 불요(prescription_codes=499행 공식 카탈로그 전체를 폴더에 dump 시 차트 picker 범람).
 *
 * 본 spec 은 구조 불변식을 정본 소스 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀) + 권한자 환경에서 브라우저 렌더 확인.
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

  test('Stage A: 2개의 행 경계(basis-full 강제 줄바꿈) div 가 존재 — 묶음처방 행1 편입 후', () => {
    // PROCMENU-RX-UNIFY item2: 묶음처방을 행1로 이동하며 '행 경계 3→묶음처방' div 제거 → 2개 잔존.
    const breaks = src.match(/basis-full h-0/g) ?? [];
    expect(breaks.length).toBe(2);
  });

  test('Stage A: 행1 순서 = 상병명 관리 → 처방세트(drug_folders) → 묶음처방(prescriptions) → 빠른처방 → 금기증', () => {
    const iDiag = src.indexOf('value="diagnosis_names"');
    const iDrug = src.indexOf('value="drug_folders"');
    const iRxSet = src.indexOf('value="prescriptions"');
    const iQuick = src.indexOf('value="quick_rx"');
    const iContra = src.indexOf('value="contraindications"');
    const iBreak1 = src.indexOf('basis-full h-0');
    [iDiag, iDrug, iRxSet, iQuick, iContra, iBreak1].forEach((i) => expect(i).toBeGreaterThan(-1));
    // 행1 트리거가 모두 첫 행 경계(div) 이전에 위치 + 묶음처방이 처방세트 바로 옆(처방세트와 빠른처방 사이)
    expect(iDiag).toBeLessThan(iDrug);
    expect(iDrug).toBeLessThan(iRxSet); // item2: 묶음처방은 처방세트 '옆'(직후)
    expect(iRxSet).toBeLessThan(iQuick);
    expect(iQuick).toBeLessThan(iContra);
    expect(iContra).toBeLessThan(iBreak1);
  });

  // T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: '상용구'(phrases)·'수가세트'(fee_set_templates)는
  //   서비스관리>상용구관리 서브탭으로 이전됨 → 진료관리(ClinicManagement) 에서는 부재해야 함.
  test('Stage A: 행2(슈퍼상용구·서류) 가 행1 경계 뒤 / 행3 경계 앞 (상용구 이전)', () => {
    const breaks = [...src.matchAll(/basis-full h-0/g)].map((m) => m.index!);
    const iSuper = src.indexOf('value="super_phrases"');
    const iDocs = src.indexOf('value="documents"');
    expect(src).not.toContain('value="phrases"'); // 상용구 이전 락인
    expect(iSuper).toBeGreaterThan(breaks[0]);
    expect(iDocs).toBeLessThan(breaks[1]);
    expect(iSuper).toBeLessThan(iDocs);
  });

  test('Stage A: 행3(진료세트·경과분석) 가 행2 경계 뒤(마지막 행, 후행 경계 없음) (수가세트 이전)', () => {
    const breaks = [...src.matchAll(/basis-full h-0/g)].map((m) => m.index!);
    const iTreat = src.indexOf('value="treatment_sets"');
    const iProg = src.indexOf('value="progress_plans"');
    expect(src).not.toContain('value="fee_set_templates"'); // 수가세트 이전 락인
    // item2 이후 묶음처방이 행1로 올라가며 행3 뒤 경계 div 제거 → 행3 = 마지막 행
    expect(iTreat).toBeGreaterThan(breaks[1]);
    expect(iTreat).toBeLessThan(iProg);
  });

  // ── Stage C: 묶음처방 영구 보존 락인 (2026-06-08 최종결정) ──────────────────────
  test('Stage C: 묶음처방·처방세트 탭이 영구 공존 — "제거 예정" 전환기 마커 부재', () => {
    // 두 탭 모두 정본 소스에 존재(직교 영구 공존)
    expect(src).toContain('value="prescriptions"'); // 묶음처방 = prescription_sets
    expect(src).toContain('value="drug_folders"'); // 처방세트 = drug_folders 폴더기능
    // 최종결정 위반 방지: prescriptions 탭에 '제거 예정'/'전환기' 한시 마커가 남으면 실패
    const block = src.match(/value="prescriptions"[\s\S]{0,400}?<\/TabsContent>/);
    // 주석/제거예정 마커는 트리거 직전 주석에 있었음 → 소스 전체에서 '제거 예정' 부재 확인
    expect(src).not.toContain('제거 예정');
    expect(block, 'prescriptions TabsContent 블록').not.toBeNull();
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
  // 묶음처방(prescriptions) 탭도 함께 노출 (영구 공존, 충돌 없이 분리)
  await expect(page.getByTestId('tab-prescription-sets-legacy')).toContainText('묶음처방');
  // 클릭 시 약품 폴더 트리(드러그 폴더 관리 화면) 렌더 — value 매핑 무회귀
  await drugTab.click();
  await expect(page.getByTestId('drug-folder-admin-tree')).toBeVisible({ timeout: 10_000 });
});
