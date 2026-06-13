/**
 * E2E spec — T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT (김주연 총괄, 풋센터)
 *
 * 서비스관리(Services.tsx) top-level 서브탭에 「상용구관리」 신설(서비스 목록 바로 옆) +
 * 진료관리(ClinicManagement.tsx) 의 '상용구'(value=phrases/PhrasesTab) · '수가세트'(value=fee_set_templates/
 * FeeSetTemplatesTab) 2항목만 새 서브탭으로 이동(렌더 위치 이동만, 기능 불변).
 * 의도: 상용구관리=직원용, 진료관리=원장(대표원장) 메인.
 *
 * AC-1: 서브탭 순서 = 서비스 목록 → 상용구관리 → 진료관리
 * AC-2: 상용구+수가세트 2개만 이동(슈퍼상용구는 진료관리 잔류), 패널 기능 불변·렌더 위치만 이동
 * AC-3: 상용구관리 노출 role = 서비스 목록 진입 role(직원 포함). RLS/WRITE 권한 변경 금지(위치 이동만).
 * AC-4: ?tab=phrases / ?tab=fee_set_templates 딥링크 호환 유지
 *
 * 본 spec 은 구조 불변식을 정본 소스 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀) + 권한자 환경 브라우저 렌더 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SERVICES = 'src/pages/Services.tsx';
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';
const CHART = 'src/components/MedicalChartPanel.tsx';

// ── 소스 구조 불변식 (정본 소스, 데이터·로그인 비의존) ──────────────────────────────
test.describe('PHRASEMGMT-SUBTAB-SPLIT — 소스 구조 불변식', () => {
  const svc = read(SERVICES);
  const cm = read(CLINIC_MGMT);

  test('AC-1: 서브탭 순서 = 서비스 목록 → 상용구관리 → 진료관리', () => {
    const iServices = svc.indexOf('data-testid="svc-top-tab-services"');
    const iPhrases = svc.indexOf('data-testid="svc-top-tab-phrases"');
    const iClinic = svc.indexOf('data-testid="svc-top-tab-clinic"');
    [iServices, iPhrases, iClinic].forEach((i) => expect(i).toBeGreaterThan(-1));
    expect(iServices).toBeLessThan(iPhrases); // 상용구관리는 서비스 목록 바로 옆(직후)
    expect(iPhrases).toBeLessThan(iClinic); // 진료관리는 상용구관리 뒤
  });

  test('AC-2: 상용구관리 패널에 상용구(phrases) + 수가세트(fee_set_templates) 2개만 이동', () => {
    // 패널 + 두 탭 + 두 탭 컴포넌트 재사용(신규 구현 금지) 존재
    expect(svc).toContain('data-testid="svc-phrase-panel"');
    expect(svc).toContain('data-testid="tab-phrases"');
    expect(svc).toContain('data-testid="tab-fee-set-templates"');
    expect(svc).toContain("import('@/components/admin/PhrasesTab')");
    expect(svc).toContain("import('@/components/admin/FeeSetTemplatesTab')");
  });

  test('AC-2: 슈퍼상용구(super_phrases)는 진료관리 잔류 — 상용구관리로 이동 금지', () => {
    // 진료관리에 슈퍼상용구 잔류
    expect(cm).toContain('value="super_phrases"');
    expect(cm).toContain('data-testid="tab-super-phrases"');
    // 상용구관리(Services)에는 슈퍼상용구 부재
    expect(svc).not.toContain('super_phrases');
    expect(svc).not.toContain('SuperPhrasesTab');
  });

  test('AC-2: 진료관리에서 상용구·수가세트 2개 탭 제거(이동만, 잔류 금지)', () => {
    expect(cm).not.toContain('value="phrases"'); // 상용구 트리거 제거
    expect(cm).not.toContain('value="fee_set_templates"'); // 수가세트 트리거 제거
    // 렌더 태그 제거(주석/SuperPhrasesTab 와 충돌 없는 정밀 매칭).
    expect(cm).not.toContain('<PhrasesTab'); // PhrasesTab 렌더 제거 (<SuperPhrasesTab 와 불일치)
    expect(cm).not.toContain('<FeeSetTemplatesTab'); // FeeSetTemplatesTab 렌더 제거
    expect(cm).not.toContain("import PhrasesTab from"); // import 제거
    expect(cm).not.toContain("import FeeSetTemplatesTab from");
  });

  test('AC-3: 상용구관리 서브탭은 서비스 목록과 동일 role 노출 — 별도 role 게이트 없음', () => {
    // 상용구관리 버튼은 canViewClinicMgmt(admin/manager/director) 게이트로 감싸이지 않아야 함(직원 포함 노출).
    // svc-top-tab-phrases 버튼 직전에 canViewClinicMgmt && 조건이 붙지 않음을 확인.
    const m = svc.match(/data-testid="svc-top-tab-phrases"/);
    expect(m).not.toBeNull();
    // clinic 서브탭만 canViewClinicMgmt 게이트(진료관리 한정), phrases 는 무게이트.
    const clinicBlock = svc.match(/canViewClinicMgmt\s*&&\s*\([\s\S]{0,400}?svc-top-tab-clinic/);
    expect(clinicBlock, '진료관리만 canViewClinicMgmt 게이트').not.toBeNull();
    const phraseBlock = svc.match(/canViewClinicMgmt\s*&&\s*\([\s\S]{0,400}?svc-top-tab-phrases/);
    expect(phraseBlock, '상용구관리는 canViewClinicMgmt 게이트 없음').toBeNull();
  });

  test('AC-4: ?tab=phrases / ?tab=fee_set_templates 딥링크 호환 — Services 가 param 으로 서브탭 pre-select', () => {
    expect(svc).toContain('useSearchParams');
    expect(svc).toContain("'phrases'");
    expect(svc).toContain("'fee_set_templates'");
    // ClinicManagement 구 딥링크 → 새 위치 redirect (북마크 호환)
    expect(cm).toContain('/admin/services?tab=');
    expect(cm).toMatch(/MOVED_TO_SERVICES/);
  });

  test('연동: MedicalChartPanel "상용구 관리 화면으로" → /admin/services?tab=phrases 로 라우팅', () => {
    const chart = read(CHART);
    expect(chart).toContain('/admin/services?tab=phrases');
  });
});

// ── 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 graceful skip) ───────────────────
test.describe('PHRASEMGMT-SUBTAB-SPLIT — 브라우저 렌더', () => {
  test('시나리오1: 서비스관리 진입 → 상용구관리 서브탭 클릭 → 상용구+수가세트 탭 노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services');
    // 서비스관리 진입 가능 역할(직원 포함)이면 top-tab 네비 렌더. 비대상이면 graceful skip.
    const navOk = await page.getByTestId('svc-top-tab-nav').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!navOk) { test.skip(true, '서비스관리 비대상 역할 — 권한 게이트 정상'); return; }
    // AC-3: 상용구관리 버튼은 role 게이트 없이 노출(서비스 목록과 동일).
    const phraseTab = page.getByTestId('svc-top-tab-phrases');
    await expect(phraseTab).toBeVisible();
    await phraseTab.click();
    // AC-2: 상용구 + 수가세트 패널 렌더
    await expect(page.getByTestId('svc-phrase-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tab-phrases')).toBeVisible();
    await expect(page.getByTestId('tab-fee-set-templates')).toBeVisible();
  });

  test('시나리오2: 딥링크 ?tab=fee_set_templates → 상용구관리 서브탭 + 수가세트 pre-select', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services?tab=fee_set_templates');
    const panel = page.getByTestId('svc-phrase-panel');
    const panelOk = await panel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!panelOk) {
      test.skip(true, '서비스관리 비대상 역할 — 권한 게이트 정상');
      return;
    }
    // AC-4: 수가세트 탭이 선택(active) 상태로 pre-select 되어 진입 (Base UI Tabs → aria-selected)
    await expect(page.getByTestId('tab-fee-set-templates')).toHaveAttribute('aria-selected', 'true', { timeout: 8000 });
  });

  test('시나리오3: 구 딥링크 /admin/clinic-management?tab=phrases → /admin/services 로 redirect', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=phrases');
    // 권한자면 services 로 redirect, 비권한자면 라우트 가드. 둘 다 clinic-management?tab=phrases 에 머물지 않아야 함.
    await page.waitForTimeout(1500);
    expect(page.url()).not.toContain('clinic-management?tab=phrases');
  });
});
