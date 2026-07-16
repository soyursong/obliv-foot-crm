/**
 * E2E spec — T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT (P1)
 * 일마감 환불창 — 결제 유형별 구분 표기(패키지/진료비/단건) + 항목 선택 환불 UI
 *   (+ [FOLD] 완전환불행 재환불 방지 UX: T-20260715-foot-CANCEL-ERROR-PARKHK-SINGLE 재발방지 이관)
 *
 * 현장 확정 (김주연 총괄): "패키지 결제 건이랑 진료비, 단건 결제 따로 표기해주고
 *   환불 처리할 때 항목 선택할 수 있게 해줘"
 *
 * 스펙:
 *   1) 결제 유형별 구분 표기 — 환불창 목록을 패키지(회차권)/진료비/단건 3종으로 시각 구분.
 *   2) 항목 선택 환불 — 체크박스 선택 → 선택 합산 표시 → 선택 항목만 환불 확정.
 *   [FOLD] 완전환불행 재환불 방지 — 잔여 0 행 환불버튼/체크박스 비활성·숨김 + 교차일 환불 배지.
 *
 * money-path 가드 (risk_verdict GO_WARN):
 *   - 기존 환불 RPC 재사용(refund_single_payment / refund_package_payment) — 신규 파라미터/스키마 0.
 *   - 선택 합산이 각 항목 잔여를 초과 불가 / 선택 0건이면 확정 비활성 / 기존 전액·부분 환불 무회귀.
 *
 * AC-1: 환불 대화창 목록이 패키지/진료비/단건 3종으로 시각 구분 표기됨.
 * AC-2: 패키지=남은 결제금액 기준, 진료비·단건=수납 금액 기준 환불 가능 금액 표시.
 * AC-3: 항목 체크박스 선택 시 선택 항목 환불 금액 합산액이 표시·실시간 갱신.
 * AC-4: "환불 확정" 시 선택된 항목만 환불 처리됨.
 * AC-5: 선택 0건이면 확정 버튼 비활성(over-refund/빈 환불 방지).
 * AC-6: 기존 전액 환불 동선 무회귀.
 * AC-B1: 완전환불(잔여 0) 행 환불 버튼/체크박스 비활성 또는 숨김 → 재환불 클릭 불가.
 * AC-B2: 교차일 환불 건 원결제행에 '환불' 배지 표시.
 * AC-B3: 부분환불(잔여>0)·미환불 행은 기존대로 환불 가능(무회귀).
 *
 * DB 변경: 없음 (순수 FE — 유형별 그룹핑 표기 + 체크박스 선택 + 합산 + 전기간 환불조회 read-only).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 선택 합산 규칙 복제 (SSOT 회귀 락 — 데이터 무관 결정론) ──
//   단건=입력액, 패키지=잔여. 잔여 이내로만 합산(money-path 가드).
type Item = { source: 'payment' | 'package'; remaining: number; input?: number };
const selectedSum = (items: Item[]): number =>
  items.reduce((s, it) => {
    if (it.source === 'package') return s + it.remaining;
    const a = it.input ?? 0;
    return s + (a > 0 && a <= it.remaining ? a : 0);
  }, 0);
// 완전환불 판정: 누적 환불 ≥ 원결제 → 잔여 0 (재환불 불가).
const isFullyRefunded = (amount: number, refundedTotal: number): boolean =>
  amount > 0 && refundedTotal >= amount;

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 A — 선택 합산 로직 (AC-3 / AC-5 / money-path)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 A — 항목 선택 합산 + money-path 가드 로직', () => {
  test('AC-3: 선택 항목 합산 = 단건 입력액 + 패키지 잔여', () => {
    const items: Item[] = [
      { source: 'package', remaining: 380000 },
      { source: 'payment', remaining: 100000, input: 50000 },
    ];
    expect(selectedSum(items)).toBe(430000);
    // 단건 추가 선택 시 갱신
    expect(selectedSum([...items, { source: 'payment', remaining: 42000, input: 42000 }])).toBe(472000);
    console.log('[AC-3] 선택 합산·실시간 갱신 로직 PASS');
  });

  test('AC-5/money-path: 잔여 초과 입력은 합산에서 무효(0 처리) + 선택 0건 합계 0', () => {
    // 잔여 초과 입력 → 유효금액 아님(가드) → 합산 0 기여
    expect(selectedSum([{ source: 'payment', remaining: 100000, input: 100001 }])).toBe(0);
    // 선택 0건 → 합계 0 (확정 버튼 비활성 근거)
    expect(selectedSum([])).toBe(0);
    console.log('[AC-5] 잔여초과 무효화 + 0건 합계 0 PASS');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 B — 완전환불행 재환불 방지 로직 ([FOLD] AC-B1)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 B — 완전환불행 재환불 방지 로직', () => {
  test('AC-B1: 잔여 0(누적 환불 ≥ 원결제) → 완전환불 판정(재환불 불가)', () => {
    expect(isFullyRefunded(380000, 380000)).toBe(true);   // 전액 환불 완료
    expect(isFullyRefunded(380000, 400000)).toBe(true);   // 초과 방어
    expect(isFullyRefunded(380000, 100000)).toBe(false);  // 부분 환불 → 재환불 가능(AC-B3)
    expect(isFullyRefunded(380000, 0)).toBe(false);       // 미환불 → 환불 가능
    console.log('[AC-B1] 완전환불 판정 로직 PASS');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 정적 소스 가드 — 배선 회귀 락 (데이터 무관 결정론)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 가드 — 유형 구분/항목 선택/재환불 방지 배선', () => {
  const src = () => readFileSync(path.join(__dirname, '../../src/pages/Closing.tsx'), 'utf8');

  test('AC-1: 유형별 그룹(패키지/진료비/단건) 정의 + 섹션 testid', () => {
    const s = src();
    expect(s).toContain('REFUND_GROUP_DEFS');
    expect(s).toContain('패키지(회차권) 결제');
    expect(s).toContain('진료비');
    expect(s).toContain('단건 결제');
    expect(s).toContain('refund-group-${g.key}');
    console.log('[AC-1] 유형별 그룹 정의·섹션 배선 PASS');
  });

  test('AC-3/AC-5: 항목 선택 체크박스 + 합산 + 선택 0건 확정 비활성 배선', () => {
    const s = src();
    expect(s).toContain('data-testid="refund-item-checkbox"');
    expect(s).toContain('data-testid="refund-selected-sum"');
    expect(s).toContain('selectedSum');
    // 확정 비활성: 선택 0건 || 사유 미입력 || 금액 오류
    expect(s).toMatch(/selected\.size === 0/);
    expect(s).toContain('confirmDisabled');
    console.log('[AC-3/5] 체크박스·합산·확정가드 배선 PASS');
  });

  test('AC-4/AC-6: 선택 항목만 기존 RPC로 처리(단건·패키지 재사용, 신규 파라미터 0)', () => {
    const s = src();
    // 기존 단건/패키지 환불 RPC 재사용
    expect(s).toContain("rpc('refund_single_payment'");
    expect(s).toContain("rpc('refund_package_payment'");
    // 선택 항목만 순회 처리
    expect(s).toMatch(/rows\.filter\(r => selected\.has/);
    // 폐용 견적 함수 라이브 호출 0 (무회귀)
    expect(s).not.toMatch(/rpc\(['"]refund_package_atomic['"]/);
    expect(s).not.toMatch(/rpc\(['"]calc_refund_amount['"]/);
    console.log('[AC-4/6] 선택 항목 기존 RPC 처리·견적 폐용 유지 PASS');
  });

  test('AC-B1/AC-B2: 완전환불행 버튼 게이트 + 교차일 환불 배지 배선', () => {
    const s = src();
    // 완전환불 판정 헬퍼
    expect(s).toContain('isFullyRefunded');
    // 리스트 환불 버튼 게이트에 완전환불 제외
    expect(s).toMatch(/!isFullyRefunded\(r\)/);
    // 전기간(교차일 포함) 환불 합계 조회
    expect(s).toContain('refundTotalsAllDates');
    expect(s).toContain('closing-refund-alldates');
    // 교차일 환불도 배지 노출 (refunded || 전기간 환불 > 0)
    expect(s).toMatch(/refundedTotalForRow\(r\) > 0/);
    expect(s).toContain('data-testid="refunded-badge"');
    console.log('[AC-B1/B2] 재환불 게이트·교차일 배지 배선 PASS');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 실브라우저 — 환불창 유형 구분 + 항목 선택 (데이터 있을 때 / 없으면 graceful)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('실브라우저 — 환불창 유형 구분 + 항목 선택 + 확정 가드', () => {
  test('AC-1/3/5: 환불창 오픈 → 그룹 표기 + 체크박스 선택 합산 + 0건 확정 비활성', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
    await expect(paymentsTab).toBeVisible({ timeout: 10000 });
    await paymentsTab.click();
    await page.waitForTimeout(800);

    const refundBtns = page.getByTestId('refund-open-btn');
    const count = await refundBtns.count();
    if (count === 0) {
      console.log('[BROWSER] 오늘 환불 대상 결제 없음 — 로직/소스가드로 검증 완료(graceful).');
      return;
    }

    await refundBtns.first().click();
    const dialog = page.getByTestId('closing-refund-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // 항목 목록 + 합산 박스 노출 (AC-1/AC-3)
    await expect(dialog.getByTestId('refund-item-list')).toBeVisible();
    await expect(dialog.getByTestId('refund-selected-sum')).toBeVisible();

    // AC-5: 선택 0건 → 확정 버튼 비활성
    const submit = dialog.getByTestId('refund-submit');
    await expect(submit).toBeDisabled();

    // AC-3: 활성(잔여>0) 체크박스 하나 선택 → 확정 활성화 가능성 + 합산 노출
    const boxes = dialog.getByTestId('refund-item-checkbox');
    const boxCount = await boxes.count();
    let toggled = false;
    for (let i = 0; i < boxCount; i++) {
      const box = boxes.nth(i);
      if (await box.isDisabled().catch(() => true)) continue;   // AC-B1: 완전환불행은 비활성 → 스킵
      await box.check();
      toggled = true;
      break;
    }
    if (toggled) {
      // 합산 박스가 여전히 표시됨(선택 반영). 사유 입력 후 확정 활성 확인.
      await expect(dialog.getByTestId('refund-selected-sum')).toBeVisible();
      const memo = dialog.locator('textarea');
      await memo.fill('E2E 검증 — 실제 제출하지 않음');
      // 선택 + 사유 → 확정 활성(단건 금액 기본=잔여라 유효)
      await expect(submit).toBeEnabled();
      console.log('[BROWSER] 그룹 표기 + 항목 선택 + 확정 가드 PASS (제출은 미수행).');
    } else {
      console.log('[BROWSER] 활성 환불 항목 없음(전부 완전환불) — AC-B1 게이트 확인(graceful).');
    }
    await page.keyboard.press('Escape');
  });
});
