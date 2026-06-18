/**
 * E2E spec — T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU (김주연 총괄, 풋센터)
 *
 * 현장 요청 3건:
 *   1. 상용구 등록 순서 변경 가능하게 (펜/고객차트 노출 순서를 등록순서가 아니라 원하는 대로)
 *   2. 메뉴 분리/호칭: [상용구(펜차트)] / [상용구(고객차트)]
 *   3. 2번차트(고객차트) 상용구는 전부 [상용구(고객차트)] surface(medical_chart)에 연결
 *
 * AC-0 그라운딩 (코드 착수 前 판정): 현장 "고객차트" == 旣존 medical_chart('진료차트') surface 의 호칭.
 *   근거: phrase_type CHECK = {pen_chart, medical_chart} 2값뿐(mig 20260526210000) — 제3 surface 없음.
 *   진료차트 패널(MedicalChartPanel)이 2번차트(고객차트) 내부에서 열리며 medical_chart 그룹을 호출.
 *   → 무DB, 신규 phrase_type 값 미추가, data-architect CONSULT 불요. 라벨/메뉴만 '고객차트'로 통일.
 *
 * AC-1(무조건 GO, 무DB): PhrasesTab 행 단위 ↑↓ 순서변경 → sort_order 일괄 UPDATE. 펜/고객차트 양 surface 공통.
 * AC-2: medical_chart 관리 메뉴 호칭 '진료차트 상용구' → '상용구(고객차트)', pen_chart 는 '상용구(펜차트)' 유지.
 *       PHRASE_TYPE_LABELS.medical_chart = '고객차트' 로 통일(값 'medical_chart' 불변).
 * AC-3: 2번차트 소비부(MedicalChartPanel)가 medical_chart(고객차트) surface 상용구를 호출 — 旣 구조 유지.
 *       소비부는 .order('sort_order') 라 AC-1 재정렬이 입력 노출순서에 즉시 반영.
 *
 * 본 spec = 구조 불변식(정본 소스, 데이터·로그인 비의존) + 권한자 브라우저 렌더(graceful skip).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PHRASES_TAB = 'src/components/admin/PhrasesTab.tsx';
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';
const SERVICES = 'src/pages/Services.tsx';
const PHRASE_TYPE_MIG = 'supabase/migrations/20260526210000_phrase_type.sql';

// ── AC-0: 그라운딩 불변식 — '고객차트'는 신규 surface 가 아니라 medical_chart 호칭 ──────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — AC-0 그라운딩(무DB·제3 surface 금지)', () => {
  test('AC-0: phrase_type 은 pen_chart|medical_chart 2값뿐 — 신규 surface 미생성', () => {
    const mig = read(PHRASE_TYPE_MIG);
    expect(mig).toMatch(/CHECK\s*\(phrase_type IN \('pen_chart', 'medical_chart'\)\)/);
    const pt = read(PHRASES_TAB);
    // 타입 유니온도 2값 고정 — 'customer_chart' 등 제3값 추가 금지
    expect(pt).toMatch(/lockedType\?:\s*'pen_chart'\s*\|\s*'medical_chart'/);
    expect(pt).not.toContain('customer_chart');
  });
});

// ── 소스 구조 불변식 ───────────────────────────────────────────────────────────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — 소스 구조 불변식', () => {
  const pt = read(PHRASES_TAB);
  const cm = read(CLINIC_MGMT);
  const svc = read(SERVICES);

  test('AC-1: ↑↓ 순서변경 버튼 + sort_order 일괄 UPDATE 경로 존재', () => {
    // 행 단위 ↑↓ 버튼
    expect(pt).toContain('data-testid="phrase-move-up-btn"');
    expect(pt).toContain('data-testid="phrase-move-down-btn"');
    expect(pt).toContain("handleMove(p.id, 'up')");
    expect(pt).toContain("handleMove(p.id, 'down')");
    // 경계 비활성 (맨 위 ↑, 맨 아래 ↓)
    expect(pt).toContain('disabled={idx === 0 || reorder.isPending}');
    expect(pt).toContain('disabled={idx === displayed.length - 1 || reorder.isPending}');
    // sort_order 일괄 UPDATE 뮤테이션
    expect(pt).toContain('function useReorderPhrases()');
    expect(pt).toMatch(/\.update\(\{\s*sort_order:\s*u\.sort_order/);
    // 조회는 sort_order 오름차순 (노출순서 = sort_order)
    expect(pt).toMatch(/\.order\('sort_order',\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  test('AC-1: handleMove 는 typeFiltered 기준 재부여(유형 전역 일관) + 변경행만 UPDATE', () => {
    expect(pt).toContain('function handleMove(phraseId: number');
    expect(pt).toContain('const full = [...typeFiltered]');
    // 10 간격 재부여(중복 sort_order 0 문제 해소)
    expect(pt).toContain('sort_order: (i + 1) * 10');
    // 변경된 행만 필터
    expect(pt).toContain('cur.sort_order !== u.sort_order');
  });

  test('AC-2: medical_chart 호칭 = 고객차트 (PHRASE_TYPE_LABELS)', () => {
    expect(pt).toMatch(/medical_chart:\s*'고객차트'/);
    expect(pt).toMatch(/pen_chart:\s*'펜차트'/);
    // 옛 호칭 '진료차트' 가 라벨 맵에 남지 않음
    expect(pt).not.toMatch(/medical_chart:\s*'진료차트'/);
  });

  test('AC-2: 관리 메뉴 — 진료관리 탭 호칭 = 상용구(고객차트), value/testid 불변', () => {
    expect(cm).toContain('상용구(고객차트)');
    // 딥링크·E2E 보존: 키/testid 불변
    expect(cm).toContain('value="medchart_phrases"');
    expect(cm).toContain('data-testid="tab-medchart-phrases"');
    // medical_chart 고정 마운트 불변
    expect(cm).toContain('<PhrasesTab lockedType="medical_chart" />');
  });

  test('AC-2: 펜차트 surface 는 상용구(펜차트) 유지(pen_chart 고정)', () => {
    expect(svc).toContain('상용구(펜차트)');
    expect(svc).toContain('<PhrasesTabPanel lockedType="pen_chart" />');
  });

  test('AC-3: 2번차트 소비부 — medical_chart(고객차트) 그룹 호출 + sort_order 정렬 유지', () => {
    const mcp = read('src/components/MedicalChartPanel.tsx');
    // 2번차트 진료차트 패널이 medical_chart 유형 상용구를 그룹으로 호출
    expect(mcp).toContain("p.phrase_type === 'medical_chart'");
    // 소비 조회가 sort_order 오름차순(AC-1 재정렬 즉시 반영)
    expect(mcp).toMatch(/\.order\('sort_order',\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  test('회귀 가드: 추가/편집·단축어 중복경고·삭제 동선 불변', () => {
    expect(pt).toContain('data-testid="phrase-add-btn"');
    expect(pt).toContain('data-testid="phrase-save-btn"');
    expect(pt).toContain('data-testid="phrase-shortcut-input"');
    expect(pt).toContain('function useUpsertPhrase()');
    expect(pt).toContain('function useDeletePhrase()');
  });
});

// ── 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 graceful skip) ─────────────────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — 브라우저 렌더', () => {
  test('렌더-①: 진료관리 → 상용구(고객차트) 탭 진입 + ↑↓ 버튼 노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=medchart_phrases');
    const trigger = page.getByTestId('tab-medchart-phrases');
    const okTab = await trigger.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okTab) { test.skip(true, '진료관리 비대상 역할 — 권한 게이트 정상'); return; }
    // 탭 호칭이 '고객차트' 로 통일됐는지
    await expect(trigger).toContainText('고객차트');
    await expect(page.getByTestId('phrase-locked-type-medical_chart')).toBeVisible({ timeout: 10_000 });
    // 상용구가 1건 이상이면 ↑↓ 버튼이 보임(0건이면 graceful skip)
    const items = page.getByTestId('phrase-item');
    const cnt = await items.count();
    if (cnt === 0) { test.skip(true, '고객차트 상용구 0건 — 재정렬 대상 없음'); return; }
    await expect(page.getByTestId('phrase-move-up-btn').first()).toBeVisible();
    await expect(page.getByTestId('phrase-move-down-btn').first()).toBeVisible();
    // 맨 위 행의 ↑ 는 비활성
    await expect(page.getByTestId('phrase-move-up-btn').first()).toBeDisabled();
  });

  test('렌더-②: 상용구(펜차트) surface 에서도 ↑↓ 순서변경 노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services?tab=phrases');
    const panel = page.getByTestId('svc-phrase-panel');
    const okPanel = await panel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okPanel) { test.skip(true, '서비스관리 비대상 역할 — 권한 게이트 정상'); return; }
    await expect(page.getByTestId('phrase-locked-type-pen_chart')).toBeVisible({ timeout: 10_000 });
    const items = page.getByTestId('phrase-item');
    if (await items.count() === 0) { test.skip(true, '펜차트 상용구 0건'); return; }
    await expect(page.getByTestId('phrase-move-down-btn').first()).toBeVisible();
  });

  test('렌더-③: 순서변경 클릭 후 첫 행이 바뀜(데이터 2건+ 일 때)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services?tab=phrases');
    const panel = page.getByTestId('svc-phrase-panel');
    const okPanel = await panel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okPanel) { test.skip(true, '서비스관리 비대상 역할'); return; }
    const items = page.getByTestId('phrase-item');
    const cnt = await items.count();
    if (cnt < 2) { test.skip(true, '재정렬 검증엔 2건+ 필요'); return; }
    const firstNameBefore = (await items.first().textContent())?.trim() ?? '';
    // 첫 행을 아래로 → 두번째와 자리 교환
    await page.getByTestId('phrase-move-down-btn').first().click();
    await page.waitForTimeout(1200); // invalidate + refetch
    const firstNameAfter = (await items.first().textContent())?.trim() ?? '';
    expect(firstNameAfter).not.toBe(firstNameBefore);
  });
});
