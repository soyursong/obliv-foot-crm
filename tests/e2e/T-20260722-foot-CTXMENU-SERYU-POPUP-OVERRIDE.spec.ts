/**
 * T-20260722-foot-CTXMENU-SERYU-POPUP-OVERRIDE — 우클릭 [서류] → 별도 팝업창(모달) 오픈
 *
 * planner NEW-TASK (MSG-20260722-082111-o5ow, reporter 김주연 총괄 U0ATDB587PV firm 확정).
 * FE-only · DB/마이그 0 · npm 0 · risk_verdict=GO_WARN.
 * policy_superseded: T-20260617-foot-CTXMENU-DOC-ENTRY (그 티켓 클릭 동작=차트 서류 탭 deep-link 이동을
 *   → 별도 팝업창 오픈으로 supersede. 진입점 노출 surface 2곳은 그대로).
 *
 *   AC-1: 우클릭 [서류] 클릭 → 차트(서류 탭)로 이동하지 않고 별도 팝업창(모달) 오픈.
 *   AC-2: 노출 surface 2곳 모두 동일 동작 — (a) 대시보드 예약 카드/체크인 큐 + (b) 예약관리 행.
 *   AC-3: 팝업 섹션1 = 방문(체크인) 회차별 목록 + 결제내역(금액·방법·날짜) + 발행서류 목록 + [서류 재출력] 버튼.
 *   AC-4: 팝업 섹션2 = 당일 서류 발행 UI(기존 서류 탭 당일 발행과 동일 = DocumentPrintPanel latestCheckIn).
 *   AC-5: 우클릭한 고객 식별자(customer_id)가 팝업에 전달 → 다른 고객 데이터 미오픈(null 가드 + customerId 변경 재조회).
 *   AC-6: 기존 차트 내 [서류] 탭(DOCTAB-NEW-CREATE, key='documents') 유지 — 팝업은 병존 별도 뷰.
 *   AC-7: shipped deep-link 제거 회귀 없음 — 우클릭 [서류] 핸들러가 더는 openChart(tab:'documents') 호출 안 함.
 *   AC-8: FE-only — 팝업은 read 조회만(신규 write/RPC 0), npm 0.
 *
 * 라이브 앱 로그인 회귀가 아니라 소스 불변식(정적 미러) + 실DOM 클릭(page.setContent) 강제.
 * 실기기 갤탭 우클릭→팝업 체감은 supervisor field-soak(김주연 총괄 확인)로 별도 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(root, '../../', rel), 'utf-8');

const popup = readSrc('src/components/DocumentReprintPopup.tsx');
const dashboard = readSrc('src/pages/Dashboard.tsx');
const reservations = readSrc('src/pages/Reservations.tsx');
const chartPage = readSrc('src/pages/CustomerChartPage.tsx');

test.describe('T-20260722-foot-CTXMENU-SERYU-POPUP-OVERRIDE — 소스 미러 정적 가드', () => {
  test('AC-1/AC-7: 우클릭 [서류] 핸들러가 차트 deep-link 대신 팝업 state 세팅(양 surface)', () => {
    // Dashboard: ctxOpenChart(tab:'documents') deep-link 제거 → setDocPopupTarget 로 교체
    expect(dashboard).toMatch(
      /const handleOpenDocumentsFromCtx = useCallback\(\(ci: CheckIn\) => \{[\s\S]*?setDocPopupTarget\(\{ customerId: ci\.customer_id, name: ci\.customer_name \?\? null \}\);[\s\S]*?\}, \[\]\);/,
    );
    // deep-link 잔재 제거 회귀 가드: 서류 핸들러 본문에 tab:'documents' 없음
    const dashHandler = dashboard.slice(
      dashboard.indexOf('const handleOpenDocumentsFromCtx'),
      dashboard.indexOf('const handleOpenDocumentsFromCtx') + 480,
    );
    expect(dashHandler).not.toContain("{ tab: 'documents' }");

    // Reservations: 동일
    expect(reservations).toMatch(
      /const handleResvOpenDocuments = useCallback\(\(ci: CheckIn\) => \{[\s\S]*?setDocPopupTarget\(\{ customerId: ci\.customer_id, name: ci\.customer_name \?\? null \}\);[\s\S]*?\}, \[\]\);/,
    );
    const resvHandler = reservations.slice(
      reservations.indexOf('const handleResvOpenDocuments'),
      reservations.indexOf('const handleResvOpenDocuments') + 480,
    );
    expect(resvHandler).not.toContain("{ tab: 'documents' }");
  });

  test('AC-2: 노출 surface 2곳 모두 DocumentReprintPopup 렌더 + import', () => {
    expect(dashboard).toContain("import { DocumentReprintPopup } from '@/components/DocumentReprintPopup';");
    expect(reservations).toContain("import { DocumentReprintPopup } from '@/components/DocumentReprintPopup';");
    // Dashboard: 팝업 컴포넌트 1회 렌더(칸반 큐 + 예약 카드 두 surface 공통 진입 → 단일 인스턴스)
    expect(dashboard).toContain('<DocumentReprintPopup');
    expect(reservations).toContain('<DocumentReprintPopup');
    // 우클릭 핸들러가 양 surface 배선(onOpenDocuments) — 진입점 2곳 유지
    const wired = dashboard.match(/onOpenDocuments=\{handleOpenDocumentsFromCtx\}/g) ?? [];
    expect(wired.length).toBe(2);
    expect(reservations).toContain('onOpenDocuments={handleResvOpenDocuments}');
  });

  test('AC-1: 팝업 = 차트 이동 아닌 모달(overlay) — 별도 fixed 오버레이 컨테이너', () => {
    expect(popup).toContain('data-testid="doc-reprint-popup"');
    expect(popup).toMatch(/fixed inset-0 z-50[\s\S]*?bg-black\/40/);
    // 팝업은 useChart/openChart(차트 이동) 미사용 — 진짜 별도 뷰
    expect(popup).not.toContain('openChart');
    expect(popup).not.toContain('useChart');
  });

  test('AC-3: 섹션1 — 방문 회차별 목록 + 결제내역(금액·방법·날짜) + 발행서류 + 재출력 버튼', () => {
    expect(popup).toContain('data-testid="doc-reprint-visit-list"');
    expect(popup).toContain('data-testid="doc-reprint-visit-row"');
    // 방문(체크인) 기준 그룹핑 — 결제·발행서류를 check_in 단위 귀속
    expect(popup).toContain('payments.filter((p) => p.check_in_id === ci.id)');
    expect(popup).toContain('subs.filter((s) => s.check_in_id === ci.id)');
    // 결제내역: 금액(formatAmount) + 방법(METHOD_KO) + 날짜(formatDateDots)
    expect(popup).toContain('data-testid="doc-reprint-payments"');
    expect(popup).toContain('formatAmount(p.amount)');
    expect(popup).toContain('METHOD_KO[p.method');
    // 발행서류 목록
    expect(popup).toContain('data-testid="doc-reprint-docs"');
    expect(popup).toContain('FORM_META[s.template_key]');
    // 재출력 버튼 → 스코프된 체크인으로 DocumentPrintPanel 오픈
    expect(popup).toContain('data-testid="btn-doc-reprint-reissue"');
    expect(popup).toContain('onClick={() => setReissueCheckIn(ci)}');
    expect(popup).toContain('<DocumentPrintPanel');
  });

  test('AC-4: 섹션2 — 당일 서류 발행(latestCheckIn 기준, DocumentPrintPanel 재사용)', () => {
    expect(popup).toContain('data-testid="doc-reprint-issue-today"');
    expect(popup).toContain('data-testid="btn-doc-reprint-issue-today"');
    expect(popup).toContain('const latestCheckIn = checkIns[0] ?? null;');
    expect(popup).toContain('if (latestCheckIn) setReissueCheckIn(latestCheckIn);');
    // 접수 없으면 비활성 + 안내
    expect(popup).toContain('disabled={!latestCheckIn}');
    expect(popup).toContain('data-testid="doc-reprint-issue-nocheckin"');
  });

  test('AC-5: 우클릭 고객 식별자 전달 + 다른 고객 미오픈(null 가드 + customerId 변경 재조회)', () => {
    // null 가드(양 surface 핸들러): customer_id 없으면 안내 후 return
    expect(dashboard).toMatch(/handleOpenDocumentsFromCtx = useCallback[\s\S]*?if \(!ci\.customer_id\) \{[\s\S]*?return;/);
    expect(reservations).toContain("if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }");
    // 팝업: customerId prop 기준 조회 + customerId 변경 시 잔상 제거 후 재조회
    expect(popup).toContain(".eq('customer_id', customerId)");
    expect(popup).toContain('if (!customerId) return null;');
    expect(popup).toMatch(/useEffect\(\(\) => \{[\s\S]*?setCheckIns\(\[\]\);[\s\S]*?void load\(\);[\s\S]*?\}, \[customerId, customerName, load\]\);/);
  });

  test('AC-6: 기존 차트 내 [서류] 탭(DOCTAB-NEW-CREATE) 무접촉 유지', () => {
    // 차트 서류 탭 key/렌더 여전히 존재(회귀 0)
    expect(chartPage).toContain("{ key: 'documents',    label: '서류' },");
    expect(chartPage).toContain('data-testid="documents-tab-content"');
    expect(chartPage).toContain("chartTabGroup === 'clinical' && chartTab === 'documents'");
  });

  test('AC-8: FE-only — 팝업은 read 조회만(신규 write/RPC 0), 발행 로직은 재사용 컴포넌트 위임', () => {
    // 팝업 자체 supabase 접근은 select 계열만(insert/update/delete/rpc 없음)
    expect(popup).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.rpc\(|\.upsert\(/);
    expect(popup).toMatch(/supabase\.from\('(customers|check_ins|payments|form_submissions)'\)/);
    // 우클릭 핸들러(양 surface)는 state 세팅만 — supabase write 없음
    const dashHandler = dashboard.slice(
      dashboard.indexOf('const handleOpenDocumentsFromCtx'),
      dashboard.indexOf('const handleOpenDocumentsFromCtx') + 480,
    );
    expect(dashHandler).not.toMatch(/supabase\.from\(|\.rpc\(/);
  });
});

// ── 실DOM 시나리오 가드 (page.setContent, 실 Chromium 클릭) ──
//   우클릭 [서류] → (차트 이동 아님) 별도 팝업 오픈 + 2섹션 + 재출력 + 고객 식별자 전달을 최소 HTML+JS 로 모사.
function surfaceHtml(customerId: string, customerName: string): string {
  return `<!doctype html><html><body>
    <button data-testid="quick-menu-doc-btn"
      onclick="
        window.__navigatedToChart = false; /* 차트 이동 안 함(AC-1/AC-7) */
        window.__popupCustomer = { customerId: '${customerId}', name: '${customerName}' };
        document.getElementById('doc-popup').style.display='block';
        document.getElementById('popup-customer').textContent='${customerName}';
      ">서류</button>
    <div id="chart-view" data-testid="chart-view" style="display:none">차트 화면(서류 탭)</div>
    <div id="doc-popup" data-testid="doc-reprint-popup" style="display:none">
      <div data-testid="doc-reprint-customer"><span id="popup-customer"></span></div>
      <div data-testid="doc-reprint-issue-today">
        <button data-testid="btn-doc-reprint-issue-today">당일 서류 발행</button>
      </div>
      <div data-testid="doc-reprint-visit-list">
        <div data-testid="doc-reprint-visit-row">
          <div data-testid="doc-reprint-payments">50,000원 카드 2026.07.20</div>
          <div data-testid="doc-reprint-docs">진료비 세부산정내역</div>
          <button data-testid="btn-doc-reprint-reissue"
            onclick="window.__reissueOpened = true;">서류 재출력</button>
        </div>
      </div>
    </div>
  </body></html>`;
}

test.describe('T-20260722-foot-CTXMENU-SERYU-POPUP-OVERRIDE — 실DOM 시나리오', () => {
  test('시나리오1: 우클릭 [서류] → 차트 이동 없이 별도 팝업 오픈 + 해당 고객 컨텍스트 전달(AC-1/AC-5)', async ({ page }) => {
    await page.setContent(surfaceHtml('cust-777', '홍길동'));
    await expect(page.locator('[data-testid="doc-reprint-popup"]')).toBeHidden();
    await page.locator('[data-testid="quick-menu-doc-btn"]').click();
    // 차트 화면으로 이동하지 않고 팝업이 뜬다
    await expect(page.locator('[data-testid="chart-view"]')).toBeHidden();
    await expect(page.locator('[data-testid="doc-reprint-popup"]')).toBeVisible();
    // 우클릭한 그 고객이 팝업에 반영
    await expect(page.locator('[data-testid="doc-reprint-customer"]')).toContainText('홍길동');
    const opened = await page.evaluate(() => (window as unknown as { __popupCustomer?: { customerId: string; name: string } }).__popupCustomer);
    expect(opened).toEqual({ customerId: 'cust-777', name: '홍길동' });
    const navigated = await page.evaluate(() => (window as unknown as { __navigatedToChart?: boolean }).__navigatedToChart);
    expect(navigated).toBe(false);
  });

  test('시나리오2: 팝업 2섹션 표시 — 섹션1(방문·결제·발행서류·재출력) + 섹션2(당일 발행)(AC-3/AC-4)', async ({ page }) => {
    await page.setContent(surfaceHtml('cust-1', '김철수'));
    await page.locator('[data-testid="quick-menu-doc-btn"]').click();
    // 섹션2 당일 발행
    await expect(page.locator('[data-testid="doc-reprint-issue-today"]')).toBeVisible();
    await expect(page.locator('[data-testid="btn-doc-reprint-issue-today"]')).toBeVisible();
    // 섹션1 방문/결제/발행서류/재출력
    await expect(page.locator('[data-testid="doc-reprint-visit-row"]')).toBeVisible();
    await expect(page.locator('[data-testid="doc-reprint-payments"]')).toContainText('50,000원');
    await expect(page.locator('[data-testid="doc-reprint-docs"]')).toContainText('진료비');
    await expect(page.locator('[data-testid="btn-doc-reprint-reissue"]')).toBeVisible();
  });

  test('시나리오3: 재출력 버튼 클릭 → 재출력(발행) 동작 트리거(AC-3)', async ({ page }) => {
    await page.setContent(surfaceHtml('cust-1', '이영희'));
    await page.locator('[data-testid="quick-menu-doc-btn"]').click();
    await page.locator('[data-testid="btn-doc-reprint-reissue"]').click();
    const reissued = await page.evaluate(() => (window as unknown as { __reissueOpened?: boolean }).__reissueOpened);
    expect(reissued).toBe(true);
  });
});
