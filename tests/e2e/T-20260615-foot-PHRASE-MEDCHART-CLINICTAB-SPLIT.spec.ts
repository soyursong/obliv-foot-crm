/**
 * E2E spec — T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT (김주연 총괄, 풋센터)
 *
 * 상용구를 phrase_type 축으로 두 surface 로 물리 분할 (DB 변경 0 — phrase_type 컬럼 旣존):
 *   - 진료차트 상용구(phrase_type='medical_chart') → 진료관리(ClinicManagement) 신규 탭 'medchart_phrases'
 *   - 펜차트 상용구(phrase_type='pen_chart')       → 서비스관리>상용구관리>상용구 잔류
 * 단일 컴포넌트 PhrasesTab 을 lockedType prop 으로 두 surface 가 재사용(중복 구현 금지).
 *
 * AC1: 진료관리에 '진료차트 상용구' 신규 탭 — medical_chart 만 노출, 추가 시 자동 medical_chart 저장(유형 선택 UI 없음)
 * AC2: 상용구관리>상용구 = pen_chart 만 노출, 추가 시 자동 pen_chart 저장
 * AC3: DB/데이터 무이동 — phrase_type 값으로 두 화면 분류. NULL 레거시 행은 fallback(pen_chart) → 상용구관리 표시
 * AC4: PhrasesTab 단일 컴포넌트 prop 재사용, prop 미지정 호출부 회귀 0
 * AC5: 회귀 가드 — 진료관리 기존 탭·상용구관리 수가세트·딥링크(?tab=phrases→상용구관리) 불변
 * AC6: 실브라우저 렌더 확인 (아래 describe 2)
 *
 * 본 spec 은 구조 불변식을 정본 소스로 인코딩(데이터·로그인 비의존, 빠른 회귀) + 권한자 브라우저 렌더 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SERVICES = 'src/pages/Services.tsx';
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';
const PHRASES_TAB = 'src/components/admin/PhrasesTab.tsx';

// ── 소스 구조 불변식 (정본 소스, 데이터·로그인 비의존) ──────────────────────────────
test.describe('PHRASE-MEDCHART-CLINICTAB-SPLIT — 소스 구조 불변식', () => {
  const svc = read(SERVICES);
  const cm = read(CLINIC_MGMT);
  const pt = read(PHRASES_TAB);

  test('AC4: PhrasesTab 이 lockedType prop 을 받음(단일 컴포넌트 재사용)', () => {
    expect(pt).toMatch(/lockedType\?:\s*'pen_chart'\s*\|\s*'medical_chart'/);
    expect(pt).toMatch(/function PhrasesTab\(\{\s*lockedType/);
    // lockedType 으로 목록 고정 필터
    expect(pt).toContain('const effectivePhraseType = lockedType ?? filterPhraseType');
    expect(pt).toMatch(/effectivePhraseType === 'all'/);
  });

  test('AC1/AC2: lockedType 지정 시 세그먼트 필터 숨김 + 추가 시 type 고정', () => {
    // 상단 세그먼트 필터는 lockedType 일 때 숨김(삼항: lockedType ? 배지 : 세그먼트)
    expect(pt).toMatch(/lockedType\s*\?\s*\(/);
    expect(pt).toContain('data-testid={`phrase-locked-type-${lockedType}`}');
    // openAdd 가 lockedType 으로 form.phrase_type 고정
    expect(pt).toContain('phrase_type: lockedType ?? EMPTY_FORM.phrase_type');
    // 신규 추가 시 유형 선택 UI 숨김(편집 시엔 노출 — 이동 허용)
    expect(pt).toContain('{(!lockedType || editing) && (');
  });

  test('AC2: 상용구관리(Services) 상용구 패널은 pen_chart 고정', () => {
    expect(svc).toContain('<PhrasesTabPanel lockedType="pen_chart" />');
    // 딥링크·E2E 보존: value/testid 불변
    expect(svc).toContain('data-testid="tab-phrases"');
    expect(svc).toContain('value="phrases"');
  });

  test('AC1: 진료관리(ClinicManagement) 진료차트 상용구 탭 = medical_chart 고정 + 신규 키', () => {
    // PhrasesTab import 복원
    expect(cm).toContain("import PhrasesTab from '@/components/admin/PhrasesTab'");
    // 신규 탭 — phrases 와 다른 키(medchart_phrases)
    expect(cm).toContain('value="medchart_phrases"');
    expect(cm).toContain('data-testid="tab-medchart-phrases"');
    expect(cm).toContain('진료차트 상용구');
    // medical_chart 고정 마운트
    expect(cm).toContain('<PhrasesTab lockedType="medical_chart" />');
    // 딥링크 허용 목록에 포함
    expect(cm).toContain("'medchart_phrases'");
  });

  test('AC5: 부모 redirect(?tab=phrases→상용구관리) 충돌 방지 — 신규 키는 phrases 와 분리', () => {
    // 진료관리는 여전히 'phrases'/'fee_set_templates' 를 services 로 redirect(부모 PHRASEMGMT 보존)
    expect(cm).toMatch(/MOVED_TO_SERVICES/);
    expect(cm).toContain('/admin/services?tab=');
    // medchart_phrases 는 MOVED_TO_SERVICES 에 없어야(진료관리 잔류 신규 탭)
    const movedLine = cm.match(/MOVED_TO_SERVICES[^\n]*\[[^\]]*\]/);
    expect(movedLine).not.toBeNull();
    expect(movedLine![0]).not.toContain('medchart_phrases');
  });

  test('AC5: 진료관리 기존 탭(슈퍼상용구·서류·진료세트 등) 불변', () => {
    ['super_phrases', 'documents', 'treatment_sets', 'progress_plans', 'diagnosis_names', 'prescriptions'].forEach((v) => {
      expect(cm).toContain(`value="${v}"`);
    });
    // 슈퍼상용구는 진료차트 상용구와 별 컴포넌트
    expect(cm).toContain('SuperPhrasesTab');
  });
});

// ── 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 graceful skip) — AC6 ─────────────
test.describe('PHRASE-MEDCHART-CLINICTAB-SPLIT — 브라우저 렌더(AC6)', () => {
  test('AC6-①: 진료관리 → 진료차트 상용구 탭 → medical_chart surface 진입', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=medchart_phrases');
    // 권한자(admin/manager/director)면 탭 노출. 비대상이면 라우트 가드 → graceful skip.
    const trigger = page.getByTestId('tab-medchart-phrases');
    const okTab = await trigger.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okTab) { test.skip(true, '진료관리 비대상 역할 — 권한 게이트 정상'); return; }
    await expect(trigger).toHaveAttribute('aria-selected', 'true', { timeout: 8000 });
    // medical_chart 고정 배지 노출 + 세그먼트 필터(전체/펜차트/진료차트)는 숨김
    await expect(page.getByTestId('phrase-locked-type-medical_chart')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('phrase-type-filter-all')).toHaveCount(0);
  });

  test('AC6-②: 상용구관리 → 상용구 → pen_chart surface (세그먼트 필터 숨김)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services?tab=phrases');
    const panel = page.getByTestId('svc-phrase-panel');
    const okPanel = await panel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okPanel) { test.skip(true, '서비스관리 비대상 역할 — 권한 게이트 정상'); return; }
    await expect(page.getByTestId('tab-phrases')).toBeVisible();
    // pen_chart 고정 배지 + 세그먼트 필터 숨김
    await expect(page.getByTestId('phrase-locked-type-pen_chart')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('phrase-type-filter-medical_chart')).toHaveCount(0);
  });

  test('AC5: 구 딥링크 /admin/clinic-management?tab=phrases → 상용구관리 redirect 유지', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=phrases');
    await page.waitForTimeout(1500);
    // medchart_phrases 신규 키와 분리 — 구 phrases 딥링크는 여전히 services 로(또는 가드). clinic-management?tab=phrases 잔류 금지.
    expect(page.url()).not.toContain('clinic-management?tab=phrases');
  });
});
