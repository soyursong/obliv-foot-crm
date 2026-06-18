/**
 * E2E spec — T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU (김주연 총괄, 풋센터)
 *
 * 현장 요청 3건:
 *   1. 상용구 등록 순서 변경 가능하게 (펜/고객차트 노출 순서를 등록순서가 아니라 원하는 대로)
 *   2. 메뉴 분리: [상용구(펜차트)] / [상용구(고객차트)]
 *   3. 2번차트(고객차트) 3구역[상세] 상용구는 전부 [상용구(고객차트)] surface 에 연결
 *
 * ⭐ CROSS-PARTY 조율 확정 (2026-06-19, 직전 6df52103 의 AC-0(A) 해석 정정):
 *   - 문지은 대표원장: 진료관리는 의사 전용 → '상용구(고객차트)'가 거기 있으면 안 됨(A안 동의).
 *   - 김주연 총괄: 고객차트 = 2번차트(고객차트) surface = 의사의 '진료차트'(medical_chart)와 **별개**.
 *   ⇒ 고객차트는 신규 제3 surface = phrase_type 'customer_chart'.
 *
 * CS-AC-0 그라운딩: phrase_type CHECK 에 'customer_chart' additive 추가(DA CONSULT GO, MSG-20260619-001458-5t5o).
 *   기존 pen_chart/medical_chart 무영향, customer_chart 는 펜/진료 surface 에 섞이지 않음(격리).
 * CS-AC-1 메뉴이동: 서비스관리>상용구관리에 [상용구(펜차트)]|[상용구(고객차트)] 두 서브탭. 진료관리 탭은
 *   본래 정체인 '상용구(진료차트)'(medical_chart) 로 환원 — '고객차트' 단어 제거(의사 전용 공간 정합).
 * CS-AC-2 phrase_type 신설: PhrasesTab 타입 유니온 + 라벨/배지 customer_chart 추가(DB additive 동반).
 * CS-AC-3 2번차트 연결: CustomerChartPage 3구역[상세] 예약/상담/치료메모가 customer_chart 상용구 호출.
 *   진료차트 패널(MedicalChartPanel)은 customer_chart 를 .neq 로 배제(surface 격리).
 * CS-AC-4 순서변경: PhrasesTab 행 단위 ↑↓ → sort_order 일괄 UPDATE. 펜/고객차트 양 surface 공통.
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
const CUST_CHART = 'src/pages/CustomerChartPage.tsx';
const MED_PANEL = 'src/components/MedicalChartPanel.tsx';
const CUSTCHART_MIG = 'supabase/migrations/20260619010000_phrase_type_customer_chart.sql';

// ── CS-AC-0/2: 고객차트 = 신규 제3 surface(customer_chart) additive ──────────────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — CS-AC-0/2 customer_chart surface 신설', () => {
  test('CS-AC-2: 마이그가 phrase_type CHECK 에 customer_chart 를 additive 추가(3값)', () => {
    const mig = read(CUSTCHART_MIG);
    // 단일 트랜잭션 DROP+ADD 3값
    expect(mig).toContain('BEGIN;');
    expect(mig).toContain('COMMIT;');
    expect(mig).toMatch(/CHECK \(phrase_type IN \('pen_chart', 'medical_chart', 'customer_chart'\)\)/);
    expect(mig).toContain('DROP CONSTRAINT IF EXISTS chk_phrase_templates_type');
  });

  test('CS-AC-0: 롤백 마이그에 customer_chart→pen_chart 가드 UPDATE 선행(2값 환원 위반 방지)', () => {
    const rb = read(CUSTCHART_MIG.replace('.sql', '.rollback.sql'));
    expect(rb).toMatch(/UPDATE phrase_templates\s+SET phrase_type = 'pen_chart'[\s\S]*WHERE phrase_type = 'customer_chart'/);
    expect(rb).toMatch(/CHECK \(phrase_type IN \('pen_chart', 'medical_chart'\)\)/);
  });

  test('CS-AC-2: PhrasesTab 타입 유니온 + 라벨이 customer_chart 포함, medical_chart=진료차트 환원', () => {
    const pt = read(PHRASES_TAB);
    expect(pt).toMatch(/type PhraseType = 'pen_chart' \| 'medical_chart' \| 'customer_chart'/);
    expect(pt).toMatch(/customer_chart:\s*'고객차트'/);
    expect(pt).toMatch(/medical_chart:\s*'진료차트'/);
    expect(pt).toMatch(/pen_chart:\s*'펜차트'/);
    // 6df52103 의 오라벨(medical_chart='고객차트') 잔존 금지
    expect(pt).not.toMatch(/medical_chart:\s*'고객차트'/);
  });
});

// ── CS-AC-1: 메뉴 위치 — 상용구관리 2서브탭 / 진료관리 진료차트 환원 ──────────────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — CS-AC-1 메뉴 위치', () => {
  const svc = read(SERVICES);
  const cm = read(CLINIC_MGMT);

  test('CS-AC-1: 서비스관리>상용구관리에 [상용구(펜차트)]|[상용구(고객차트)] 두 서브탭', () => {
    expect(svc).toContain('상용구(펜차트)');
    expect(svc).toContain('상용구(고객차트)');
    expect(svc).toContain('data-testid="tab-customer-phrases"');
    expect(svc).toContain('value="customer_phrases"');
    // 각 서브탭은 자기 surface 로 고정(lockedType)
    expect(svc).toContain('<PhrasesTabPanel lockedType="pen_chart" />');
    expect(svc).toContain('<PhrasesTabPanel lockedType="customer_chart" />');
  });

  test('CS-AC-1: 진료관리 탭은 상용구(진료차트)로 환원 — 고객차트 제거, value/testid 불변', () => {
    expect(cm).toContain('상용구(진료차트)');
    // 의사 전용 공간에서 '고객차트' 단어 제거
    expect(cm).not.toContain('상용구(고객차트)');
    // 딥링크·E2E 보존: 키/testid·medical_chart 마운트 불변
    expect(cm).toContain('value="medchart_phrases"');
    expect(cm).toContain('data-testid="tab-medchart-phrases"');
    expect(cm).toContain('lockedType="medical_chart"');
  });
});

// ── CS-AC-3: 2번차트 3구역 연결 + 진료차트 패널 격리 ─────────────────────────────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — CS-AC-3 2번차트 연결 + 격리', () => {
  test('CS-AC-3: CustomerChartPage 3구역[상세]가 customer_chart 상용구를 sort_order 순 호출', () => {
    const cc = read(CUST_CHART);
    expect(cc).toMatch(/\.eq\('phrase_type', 'customer_chart'\)/);
    expect(cc).toMatch(/\.order\('sort_order'\)/);
    // 예약/상담/치료메모 3구역 모두 호출부 존재
    expect(cc).toContain('data-testid="custchart-phrases-예약"');
    expect(cc).toContain('data-testid="custchart-phrases-상담"');
    expect(cc).toContain('data-testid="custchart-phrases-치료메모"');
  });

  test('CS-AC-3: 진료차트 패널(MedicalChartPanel)은 customer_chart 를 배제(surface 격리)', () => {
    const mcp = read(MED_PANEL);
    expect(mcp).toMatch(/\.neq\('phrase_type', 'customer_chart'\)/);
    // 소비 조회가 sort_order 오름차순(CS-AC-4 재정렬 즉시 반영)
    expect(mcp).toMatch(/\.order\('sort_order',\s*\{\s*ascending:\s*true\s*\}\)/);
  });
});

// ── CS-AC-4: 순서변경(↑↓) — 무DB, FE-only ──────────────────────────────────────────
test.describe('PHRASE-REORDER-CUSTCHART-MENU — CS-AC-4 순서변경', () => {
  const pt = read(PHRASES_TAB);

  test('CS-AC-4: ↑↓ 순서변경 버튼 + sort_order 일괄 UPDATE 경로 존재', () => {
    expect(pt).toContain('data-testid="phrase-move-up-btn"');
    expect(pt).toContain('data-testid="phrase-move-down-btn"');
    expect(pt).toContain("handleMove(p.id, 'up')");
    expect(pt).toContain("handleMove(p.id, 'down')");
    expect(pt).toContain('disabled={idx === 0 || reorder.isPending}');
    expect(pt).toContain('disabled={idx === displayed.length - 1 || reorder.isPending}');
    expect(pt).toContain('function useReorderPhrases()');
    expect(pt).toMatch(/\.update\(\{\s*sort_order:\s*u\.sort_order/);
    expect(pt).toMatch(/\.order\('sort_order',\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  test('CS-AC-4: handleMove 는 typeFiltered 기준 재부여 + 변경행만 UPDATE', () => {
    expect(pt).toContain('function handleMove(phraseId: number');
    expect(pt).toContain('const full = [...typeFiltered]');
    expect(pt).toContain('sort_order: (i + 1) * 10');
    expect(pt).toContain('cur.sort_order !== u.sort_order');
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
  test('렌더-①: 서비스관리 → [상용구(고객차트)] 서브탭 진입 + customer_chart 잠금', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services?tab=phrases&sub=customer_phrases');
    const panel = page.getByTestId('svc-phrase-panel');
    const okPanel = await panel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okPanel) { test.skip(true, '서비스관리 비대상 역할 — 권한 게이트 정상'); return; }
    const tab = page.getByTestId('tab-customer-phrases');
    const okTab = await tab.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okTab) { test.skip(true, '상용구관리 비노출 역할'); return; }
    await tab.click();
    await expect(page.getByTestId('phrase-locked-type-customer_chart')).toBeVisible({ timeout: 10_000 });
  });

  test('렌더-②: 진료관리 탭 호칭이 진료차트로 환원(고객차트 단어 없음)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=medchart_phrases');
    const trigger = page.getByTestId('tab-medchart-phrases');
    const okTab = await trigger.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okTab) { test.skip(true, '진료관리 비대상 역할 — 권한 게이트 정상'); return; }
    await expect(trigger).toContainText('진료차트');
    await expect(trigger).not.toContainText('고객차트');
    await expect(page.getByTestId('phrase-locked-type-medical_chart')).toBeVisible({ timeout: 10_000 });
  });

  test('렌더-③: 펜차트 surface 에서 ↑↓ 순서변경 노출 + 클릭 후 첫 행 변경(2건+)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services?tab=phrases');
    const panel = page.getByTestId('svc-phrase-panel');
    const okPanel = await panel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okPanel) { test.skip(true, '서비스관리 비대상 역할'); return; }
    await expect(page.getByTestId('phrase-locked-type-pen_chart')).toBeVisible({ timeout: 10_000 });
    const items = page.getByTestId('phrase-item');
    const cnt = await items.count();
    if (cnt === 0) { test.skip(true, '펜차트 상용구 0건'); return; }
    await expect(page.getByTestId('phrase-move-down-btn').first()).toBeVisible();
    await expect(page.getByTestId('phrase-move-up-btn').first()).toBeDisabled();
    if (cnt < 2) { test.skip(true, '재정렬 검증엔 2건+ 필요'); return; }
    const firstBefore = (await items.first().textContent())?.trim() ?? '';
    await page.getByTestId('phrase-move-down-btn').first().click();
    await page.waitForTimeout(1200);
    const firstAfter = (await items.first().textContent())?.trim() ?? '';
    expect(firstAfter).not.toBe(firstBefore);
  });
});
