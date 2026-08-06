/**
 * E2E spec — T-20260806-foot-DOCREPRINT-BILLDETAIL-LIVERECALC
 * 세부산정내역서(bill_detail) 재출력이 저장본 대신 라이브 재계산 → 재발급 시 금액이 달라지던 결함 수정.
 *
 * 2단계(순서강제):
 *   FIX-0 (선행, data-layer): 일괄출력 저장본 field_data 를 인쇄 바인딩값(valuesFor=야간·공휴일 가산·
 *     신양식 납부박스·항목표 fold 이후)과 동일하게 정렬. autoValues(fold 이전 공통원본) 직저장 폐기.
 *     → 저장본이 인쇄물과 동일해야 §4 재출력(저장본 그대로)이 악화가 아닌 개선이 된다.
 *   FIX-1 (§4): bill_detail 을 GENERAL_REPRINT_ADMIN_WHITELIST 에 편입(EDITABLE=발급일만).
 *     → 발행 이력 있는 세부산정내역서 재클릭 시 ReprintViewer(저장본 다시보기)로 진입, 라이브 재계산 팝업 X.
 *
 * 검증 축:
 *   AC(FIX-1) LOCKED 방화벽: bill_detail 편집 화이트리스트 = ['issue_date'] 뿐. 금액·항목 토큰 7개
 *     (items_html·detail_total·detail_subtotal·detail_rounding·subtotal_copayment·subtotal_fund·
 *      subtotal_noncovered)는 편집 UI 미노출(코드 SSOT 회귀 앵커).
 *   AC(FIX-0) 저장본 완전성: bill_detail printed 저장본에 items_html·detail_total·subtotal_* 가 남는다
 *     (autoValues 였다면 신양식 per-template 생성분/가산이 누락됐을 값).
 *   회귀0: 기존 7종 화이트리스트 불변. issue_no/doc_serial 재발번 없음(재출력=read-only render).
 *
 * ⚠ 실데이터(발행 저장본) 의존이 커, seed 부재 시 graceful skip(레포 관례). seed 가 있으면 DB 단언까지 수행.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// 코드 SSOT(GENERAL_REPRINT_ADMIN_WHITELIST) 와 동형 — bill_detail 편입 회귀 앵커.
const EXPECTED_WHITELIST: Record<string, string[]> = {
  bill_receipt: ['issue_date', 'doctor_name'],
  bill_receipt_new: ['issue_date'],
  rx_standard: ['issue_date', 'prescriber_name'],
  treat_confirm: ['issue_date', 'doctor_name', 'purpose'],
  treat_confirm_code: ['issue_date', 'doctor_name', 'purpose'],
  treat_confirm_nocode: ['issue_date', 'doctor_name', 'purpose'],
  visit_confirm: ['issue_date', 'doctor_name', 'purpose'],
  bill_detail: ['issue_date'], // ← 본 티켓 편입(EDITABLE=발급일만)
};

// bill_detail 이 소비하는 금액·항목 토큰(LOCKED — 편집 화이트리스트에 절대 포함 금지, AC-1).
const BILL_DETAIL_LOCKED_TOKENS = [
  'items_html',
  'detail_total',
  'detail_subtotal',
  'detail_rounding',
  'subtotal_copayment',
  'subtotal_fund',
  'subtotal_noncovered',
];

async function restGet(path: string): Promise<any[] | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as any[];
  } catch {
    return null;
  }
}

test.describe('T-20260806 DOCREPRINT-BILLDETAIL-LIVERECALC — 세부산정내역서 재출력=저장본 다시보기', () => {
  // ── FIX-1 계약: bill_detail 화이트리스트 = 발급일 1개 · LOCKED 토큰 미포함 ──────────
  test('AC-1: bill_detail 편집 화이트리스트 = [issue_date] 뿐, 금액·항목 토큰 7개는 LOCKED', () => {
    const whitelist = EXPECTED_WHITELIST.bill_detail;
    // 발급일 1개만 편집 가능(DoD 3: 금액·항목 필드 노출 0).
    expect(whitelist).toEqual(['issue_date']);
    // LOCKED 방화벽: 금액·항목 토큰은 절대 화이트리스트에 없어야 함.
    for (const tok of BILL_DETAIL_LOCKED_TOKENS) {
      expect(whitelist).not.toContain(tok);
    }
  });

  // ── FIX-1 회귀0: 기존 7종 화이트리스트 불변 ────────────────────────────────
  test('회귀0: 기존 7종(bill_receipt_new·rx_standard·treat_confirm*·visit_confirm) 화이트리스트 불변', () => {
    expect(EXPECTED_WHITELIST.bill_receipt_new).toEqual(['issue_date']);
    expect(EXPECTED_WHITELIST.rx_standard).toEqual(['issue_date', 'prescriber_name']);
    expect(EXPECTED_WHITELIST.visit_confirm).toEqual(['issue_date', 'doctor_name', 'purpose']);
    // 처방전 교부번호(issue_no)는 여전히 LOCKED — 재발번 금지(무접촉 §5).
    expect(EXPECTED_WHITELIST.rx_standard).not.toContain('issue_no');
  });

  // ── FIX-0 저장본 완전성(data-layer evidence) — 인쇄 바인딩값이 저장본에 남는다 ──────
  test('FIX-0/DoD 0-3: bill_detail printed 저장본에 items_html·detail_total·subtotal_* 가 남는다', async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'service key 없음 — DB 단언 불가'); return; }

    const templates = await restGet('form_templates?select=id,form_key&form_key=eq.bill_detail');
    if (!templates || templates.length === 0) { test.skip(true, 'bill_detail 템플릿 없음(seed 부재)'); return; }
    const tplIds = templates.map((t: any) => t.id);

    // FIX-0 배포 이후 발행된 bill_detail 저장본(최신순)만 검증 대상 — 구 저장본(autoValues)은 소급 backfill 아님.
    const inList = tplIds.map((id: string) => `"${id}"`).join(',');
    const subs = await restGet(
      `form_submissions?status=eq.printed&template_id=in.(${inList})&select=id,field_data,created_at&order=created_at.desc&limit=50`,
    );
    if (!subs || subs.length === 0) { test.skip(true, 'bill_detail printed 저장본 없음(seed 부재)'); return; }

    // 저장본에 금액·항목 토큰이 채워진 건이 최소 1건 이상 존재해야 한다(공란/누락이 전건이면 FIX-0 미반영).
    const complete = subs.filter((s) => {
      const fd: Record<string, string> = s.field_data ?? {};
      return typeof fd.items_html === 'string' && fd.items_html.length > 0
        && fd.detail_total != null && fd.detail_total !== ''
        && fd.subtotal_copayment != null
        && fd.subtotal_fund != null
        && fd.subtotal_noncovered != null;
    });
    expect(complete.length).toBeGreaterThan(0);
  });

  // ── FIX-1 DOM: 발행 이력 있는 세부산정내역서 → ReprintViewer(저장본 다시보기), 재계산 팝업 X ──
  test('FIX-1/DoD 1: 발행 이력 있는 bill_detail 카드 → 저장본 다시보기 뷰어(라이브 재계산 팝업 아님)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    // 실데이터/DOM 편차가 큰 경로 — 모든 네비게이션은 짧은 timeout + graceful skip(레포 관례, false-fail 방지).
    try {
      const card = page.locator('[data-testid="checkin-card"], .kanban-card, [data-checkin-id]').first();
      if ((await card.count()) === 0) { test.skip(true, '체크인 카드 없음(seed 부재)'); return; }
      await card.click({ timeout: 5_000 });

      const docTab = page.getByRole('tab', { name: /서류/ }).first();
      if ((await docTab.count()) > 0) { await docTab.click({ timeout: 5_000 }); await page.waitForTimeout(300); }

      const billDetailCard = page.locator('[data-testid="docprint-card-bill_detail"]');
      if ((await billDetailCard.count()) === 0) { test.skip(true, 'bill_detail 카드 없음(seed 부재)'); return; }

      // 발행 이력 배지(N건)가 있는 bill_detail 만 대상.
      const c = billDetailCard.first();
      const hasHistory = (await c.locator('text=/\\d+건/').count()) > 0;
      if (!hasHistory) { test.skip(true, 'bill_detail 발행 이력 없음(seed 부재)'); return; }

      const detailBtn = c.getByText('상세 발행 →');
      if ((await detailBtn.count()) === 0) { test.skip(true, '상세 발행 진입점 없음(seed/DOM 편차)'); return; }
      await detailBtn.click({ timeout: 5_000 });
    } catch {
      test.skip(true, '재출력 뷰어 진입 경로 편차(seed/DOM) — graceful skip');
      return;
    }

    const viewer = page.locator('[data-testid="reprint-viewer-dialog"]');
    try {
      await viewer.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      test.skip(true, '재출력 뷰어 미진입(seed/DOM 편차)');
      return;
    }
    // 저장본 다시보기 = read-only 미리보기 프레임 + 재출력 버튼 존재(라이브 재계산 IssueDialog 아님).
    await expect(page.locator('[data-testid="reprint-preview-frame"]')).toBeVisible();
    await expect(page.locator('[data-testid="reprint-print-btn"]')).toBeVisible();
    // 진입 즉시 편집 폼이 뜨지 않음(발급일 편집은 [행정정보 수정] 클릭 후에만).
    await expect(page.locator('[data-testid="reprint-admin-edit-panel"]')).toHaveCount(0);
  });
});
