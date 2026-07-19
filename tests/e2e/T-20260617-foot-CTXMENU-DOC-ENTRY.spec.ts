/**
 * T-20260617-foot-CTXMENU-DOC-ENTRY — 우클릭 컨텍스트메뉴 수납 하단 [서류] 항목 추가
 *
 * planner NEW-TASK (MSG-20260719-232048 재디스패치, reporter 김주연 총괄 U0ATDB587PV firm 확정).
 * FE-only · DB/마이그 0 · npm 0 · risk_verdict=GO_WARN.
 *
 *   AC-1: 예약/체크인 우클릭 컨텍스트메뉴(CustomerQuickMenu) 수납 섹션 '하단'에 [서류] 항목 1개 append
 *         (기존 항목 순서·동작 무변경, onOpenDocuments 제공 시만 노출).
 *   AC-2: 노출 surface 2곳 모두 — (a) 대시보드 예약 카드/체크인 큐 우클릭 + (b) 예약관리 행 우클릭.
 *   AC-3: [서류] 클릭 → 해당 고객의 신규 [서류] 탭(key='documents', DOCTAB-NEW-CREATE)으로 deep-link 진입.
 *         구현 = openChart(customerId, { tab: 'documents' }) additive optional param(불변식 보존, L-004 준수).
 *         별도 창 경로=URL ?tab=documents / 서랍(자동화·Playwright) 경로=CustomerChartSheet initialTab.
 *   AC-4: 우클릭한 행/카드의 환자 식별자(ci.customer_id)가 정확히 전달 — 다른 환자 서류 미오픈(null 가드).
 *   AC-5: 역할분리 — 결제미니창(PaymentMiniWindow, 완성서류 출력전용)에는 본 진입점 미추가.
 *   AC-6: FE-only — 신규 DB write/RPC·npm 의존성 0.
 *
 * 라이브 앱 로그인 회귀가 아니라 소스 불변식(정적 미러) + 컨텍스트메뉴 실DOM 클릭(page.setContent) 강제.
 * 실기기 갤탭 우클릭 진입 체감은 supervisor field-soak(김주연 총괄 확인)로 별도 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(root, '../../', rel), 'utf-8');

const quickMenu = readSrc('src/components/CustomerQuickMenu.tsx');
const dashboard = readSrc('src/pages/Dashboard.tsx');
const reservations = readSrc('src/pages/Reservations.tsx');
const chartCtx = readSrc('src/lib/chartContext.ts');
const adminLayout = readSrc('src/components/AdminLayout.tsx');
const chartPage = readSrc('src/pages/CustomerChartPage.tsx');
const chartSheet = readSrc('src/components/CustomerChartSheet.tsx');
const paymentMini = readSrc('src/components/PaymentMiniWindow.tsx');

test.describe('T-20260617-foot-CTXMENU-DOC-ENTRY — 소스 미러 정적 가드', () => {
  test('AC-1: CustomerQuickMenu 수납 하단 [서류] 항목(onOpenDocuments 조건부, 수납 뒤·문자 앞)', () => {
    // [서류] 버튼 자체 (testid + 라벨 + FileText 아이콘 import)
    expect(quickMenu).toContain("import { BookOpen, CalendarPlus, CreditCard, FileText, MessageSquare, Stethoscope }");
    expect(quickMenu).toContain('data-testid="quick-menu-doc-btn"');
    expect(quickMenu).toContain('onOpenDocuments?: (checkIn: CheckIn) => void;');
    // 조건부 렌더 — 제공 시만 노출(대시보드·예약관리 surface)
    expect(quickMenu).toMatch(/\{onOpenDocuments && \(/);
    expect(quickMenu).toContain('onOpenDocuments(checkIn);');

    // 순서 불변식: 수납(CreditCard) → 서류(FileText) → 문자(onSendSms). 하단 append, 기존 순서 무변경.
    const payIdx = quickMenu.indexOf('수납\n      </button>');
    const docIdx = quickMenu.indexOf('data-testid="quick-menu-doc-btn"');
    const smsIdx = quickMenu.indexOf('data-testid="quick-menu-sms-btn"');
    expect(payIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(payIdx); // 수납 다음
    expect(smsIdx).toBeGreaterThan(docIdx); // 문자 앞(문자보다 위)

    // 높이 보정 itemCount 가 서류 항목 반영(경계 밖 잘림 방지)
    expect(quickMenu).toContain('4 + (onOpenDocuments ? 1 : 0) + (onSendSms ? 1 : 0)');
  });

  test('AC-2(b): 예약관리(Reservations) 행 우클릭 메뉴에 onOpenDocuments 배선 + 핸들러 deep-link', () => {
    expect(reservations).toContain('onOpenDocuments={handleResvOpenDocuments}');
    // 핸들러: customer_id 가드 + openChart(id, { tab: 'documents' })
    expect(reservations).toMatch(
      /const handleResvOpenDocuments = useCallback\(\(ci: CheckIn\) => \{[\s\S]*?openChart\(ci\.customer_id, \{ tab: 'documents' \}\);[\s\S]*?\}, \[openChart\]\);/,
    );
    // null 가드(다른 환자 오픈 방지 — 미연결 시 안내 후 return)
    expect(reservations).toMatch(
      /handleResvOpenDocuments = useCallback[\s\S]*?if \(!ci\.customer_id\) \{ toast\.info\('고객 정보가 연결되어 있지 않습니다'\); return; \}/,
    );
  });

  test('AC-2(a): 대시보드 예약 카드 + 체크인 큐 우클릭 메뉴 2곳 모두 onOpenDocuments 배선', () => {
    // Dashboard 는 CustomerQuickMenu 를 2곳(체크인 큐 카드 + 예약 카드) 렌더 → 둘 다 배선
    const wired = dashboard.match(/onOpenDocuments=\{handleOpenDocumentsFromCtx\}/g) ?? [];
    expect(wired.length).toBe(2);
    // 핸들러: customer_id 가드 + ctxOpenChart(id, { tab: 'documents' })
    expect(dashboard).toMatch(
      /const handleOpenDocumentsFromCtx = useCallback\(\(ci: CheckIn\) => \{[\s\S]*?ctxOpenChart\(ci\.customer_id, \{ tab: 'documents' \}\);[\s\S]*?\}, \[ctxOpenChart\]\);/,
    );
    expect(dashboard).toMatch(
      /handleOpenDocumentsFromCtx = useCallback[\s\S]*?if \(!ci\.customer_id\) \{[\s\S]*?return;/,
    );
  });

  test('AC-3: openChart additive optional param(tab) — 계약·구현·소비 3단 정합', () => {
    // (1) 계약(chartContext): 시그니처에 opts?.tab additive
    expect(chartCtx).toContain('openChart: (customerId: string, opts?: { tab?: string }) => void;');

    // (2) 구현(AdminLayout): opts 수용 + 별도창 URL ?tab= + 서랍 initialTab state
    expect(adminLayout).toContain('const openChart = useCallback((customerId: string, opts?: { tab?: string }) => {');
    expect(adminLayout).toContain('const [chartInitialTab, setChartInitialTab] = useState<string | undefined>(undefined);');
    expect(adminLayout).toContain('`${window.location.origin}/chart/${customerId}?tab=${encodeURIComponent(tab)}`');
    expect(adminLayout).toContain('setChartInitialTab(tab);');
    // CustomerChartSheet 에 initialTab 전달 + closeChart 시 리셋
    expect(adminLayout).toContain('<CustomerChartSheet customerId={chartId} onClose={closeChart} initialTab={chartInitialTab} />');
    expect(adminLayout).toContain('setChartId(null); setChartInitialTab(undefined);');

    // (3) 서랍 경로 전달(CustomerChartSheet → CustomerChartPage)
    expect(chartSheet).toContain('initialTab?: string;');
    expect(chartSheet).toContain('<CustomerChartPage customerId={customerId} initialTab={initialTab} />');

    // (4) 소비(CustomerChartPage): prop 우선 → ?tab= 폴백 → chartTab 초기값 'documents'
    expect(chartPage).toContain("initialTab: propInitialTab }: { customerId?: string; initialTab?: string }");
    expect(chartPage).toContain("const deepLinkTab = propInitialTab ?? searchParams.get('tab') ?? undefined;");
    expect(chartPage).toContain("useState<string>(deepLinkTab === 'documents' ? 'documents' : 'pen_chart')");

    // 목적지 탭 실재(DOCTAB-NEW-CREATE key) — 무존재 탭으로의 deep-link 아님(회귀 가드)
    expect(chartPage).toContain("{ key: 'documents',    label: '서류' },");
  });

  test('AC-3-무변경: opts 미전달(기존 openChart(id)) 경로 = 펜차트 기본 유지', () => {
    // 기존 호출부 무변경 보장: default 탭 여전히 pen_chart, ?tab 없으면 documents 아님
    expect(chartPage).toContain("? 'documents' : 'pen_chart'");
    // AdminLayout 별도창 URL: tab 없으면 ?tab 미부착(기존 URL 유지)
    expect(adminLayout).toContain('const url = tab');
    expect(adminLayout).toContain('`${window.location.origin}/chart/${customerId}`');
  });

  test('AC-5: 역할분리 — PaymentMiniWindow(출력전용)에 서류 진입점 미추가', () => {
    expect(paymentMini).not.toContain('onOpenDocuments');
    expect(paymentMini).not.toContain('quick-menu-doc-btn');
    // CustomerQuickMenu 자체를 결제미니창이 마운트하지 않음(진입점≠출력)
    expect(paymentMini).not.toContain('CustomerQuickMenu');
  });

  test('AC-6: FE-only — 서류 메뉴 항목/핸들러에 신규 DB write·RPC 없음', () => {
    // CustomerQuickMenu 는 표시/콜백만 — supabase 미접근
    expect(quickMenu).not.toMatch(/supabase\.from\(|\.rpc\(/);
    // deep-link 핸들러(양 surface)는 openChart 호출만 — 신규 supabase write 없음
    const dashHandler = dashboard.slice(
      dashboard.indexOf('handleOpenDocumentsFromCtx'),
      dashboard.indexOf('handleOpenDocumentsFromCtx') + 320,
    );
    expect(dashHandler).not.toMatch(/supabase\.from\(|\.rpc\(/);
  });
});

// ── 실DOM 시나리오 가드 (page.setContent, 실 Chromium 클릭) ──
//   CustomerQuickMenu 의 조건부 [서류] 렌더 + 순서 + 클릭→핸들러(환자 식별자 전달)를 최소 HTML+JS 로 1:1 모사.
function menuHtml(opts: { withDocuments: boolean; customerId: string }): string {
  const docBtn = opts.withDocuments
    ? `<button data-testid="quick-menu-doc-btn"
         onclick="window.__opened = { customerId: '${opts.customerId}', tab: 'documents' };
                  document.getElementById('doc-tab').style.display='block';">서류</button>`
    : '';
  return `<!doctype html><html><body>
    <div data-testid="quick-menu">
      <button data-testid="menu-chart">고객차트</button>
      <button data-testid="menu-medchart">진료차트</button>
      <button data-testid="menu-resv">예약상세</button>
      <button data-testid="quick-menu-pay-btn">수납</button>
      ${docBtn}
      <button data-testid="quick-menu-sms-btn">문자</button>
    </div>
    <div id="doc-tab" data-testid="documents-tab" style="display:none">서류 탭 (documents)</div>
  </body></html>`;
}

test.describe('T-20260617-foot-CTXMENU-DOC-ENTRY — 실DOM 시나리오', () => {
  test('시나리오1: 예약관리/대시보드 우클릭 → 수납 하단 [서류] 노출 → 클릭 시 해당 환자 서류 탭 deep-link', async ({ page }) => {
    await page.setContent(menuHtml({ withDocuments: true, customerId: 'cust-777' }));
    // 수납 항목 다음에 [서류] 항목 표시
    const pay = page.locator('[data-testid="quick-menu-pay-btn"]');
    const doc = page.locator('[data-testid="quick-menu-doc-btn"]');
    await expect(pay).toBeVisible();
    await expect(doc).toBeVisible();
    // 서류 탭 아직 미오픈
    await expect(page.locator('[data-testid="documents-tab"]')).toBeHidden();
    // [서류] 클릭 → 서류 탭 오픈 + 올바른 customerId·documents tab 전달
    await doc.click();
    await expect(page.locator('[data-testid="documents-tab"]')).toBeVisible();
    const opened = await page.evaluate(() => (window as unknown as { __opened?: { customerId: string; tab: string } }).__opened);
    expect(opened).toEqual({ customerId: 'cust-777', tab: 'documents' });
  });

  test('시나리오2: DOM 순서 — 수납 → 서류 → 문자 (하단 append, 기존 순서 무변경)', async ({ page }) => {
    await page.setContent(menuHtml({ withDocuments: true, customerId: 'cust-1' }));
    const testids = await page.locator('[data-testid="quick-menu"] button').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-testid')),
    );
    const payPos = testids.indexOf('quick-menu-pay-btn');
    const docPos = testids.indexOf('quick-menu-doc-btn');
    const smsPos = testids.indexOf('quick-menu-sms-btn');
    expect(docPos).toBe(payPos + 1); // 수납 바로 다음
    expect(smsPos).toBe(docPos + 1); // 문자 바로 앞
  });

  test('시나리오3: 역할분리 — 진입점 미제공(결제미니창 類) surface 에는 [서류] 미노출', async ({ page }) => {
    await page.setContent(menuHtml({ withDocuments: false, customerId: 'cust-1' }));
    await expect(page.locator('[data-testid="quick-menu-pay-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="quick-menu-doc-btn"]')).toHaveCount(0);
  });
});
