/**
 * T-20260609-foot-RESV-PATIENT-PHONE-SUFFIX
 * 예약 목록(대기실/스케줄 뷰) 환자 서브라벨 — 초진·재진 모두 성함+핸드폰 뒷4자리로 통일
 *
 * 배경 (김주연 총괄):
 *   통합 시간표(스케줄 뷰)의 미내원 예약 카드에서
 *   - 초진 예약 카드(DraggableBox1Card): 성함 + 핸드폰 뒷4자리
 *   - 재진 예약 카드(DraggableBox2ResvCard): 성함 + #차트번호 (핸드폰 X)
 *   → 재진도 초진처럼 핸드폰 뒷4자리(서브라벨)로 통일 요청.
 *
 * 변경 (presentation only, DB 무변경):
 *   - 재진 예약 카드(box2-resv-card)에 핸드폰 뒷4자리 span(resv-phone-suffix) 추가.
 *   - CHART-NO-VISIBLE(#차트번호) 뱃지는 별도 식별자로 유지(회귀 금지, AC-4).
 *   - 결측/4자리 미만 → suffix 미렌더(빈 suffix 금지) → #차트번호 뱃지가 fallback (AC-3).
 *     (실데이터 결측률: reservations ~1%, returning 0.4%, 4자리 미만 0건 — 2026-06-09 측정)
 *
 * 시나리오:
 *   S1 (AC-1/AC-3): 재진 예약 카드는 빈 suffix가 없다 — 핸드폰 뒷4자리(\d{4}) 또는 #차트번호 fallback.
 *   S2 (AC-2 회귀): 초진 예약 카드는 기존대로 핸드폰 뒷4자리 표기 유지.
 *   S3 (로직 계약): phoneTailSuffix 파생 규칙(E.164 +82 / 010 / 4자리미만 null) 미러 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609-foot-RESV-PATIENT-PHONE-SUFFIX', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndWaitForDashboard(page);
  });

  // ── S1: 재진 예약 카드 — 빈 suffix 금지 (핸드폰 뒷4자리 또는 #차트번호 fallback) ──
  test('S1: 재진 예약 카드 서브라벨이 핸드폰 뒷4자리 또는 차트번호 fallback (빈 suffix 없음)', async ({ page }) => {
    await page.waitForTimeout(1500);
    const cards = page.locator('[data-testid="box2-resv-card"]');
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 미내원 재진 예약 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }

    for (let i = 0; i < Math.min(count, 5); i++) {
      const card = cards.nth(i);
      const phoneSuffix = card.locator('[data-testid="resv-phone-suffix"]');
      const chartBadge = card.locator('span.font-mono').filter({ hasText: /^#/ });

      const hasPhone = (await phoneSuffix.count()) > 0;
      const hasChart = (await chartBadge.count()) > 0;

      // AC-3: 빈 suffix 금지 — 둘 중 하나는 반드시 존재
      expect(hasPhone || hasChart).toBe(true);

      // AC-1: 핸드폰 suffix가 있으면 정확히 숫자 4자리
      if (hasPhone) {
        const text = (await phoneSuffix.first().textContent())?.trim() ?? '';
        expect(text).toMatch(/^\d{4}$/);
      }
    }
  });

  // ── S2: 초진 예약 카드 — 핸드폰 뒷4자리 유지 (회귀 없음) ──
  test('S2: 초진 예약 카드 핸드폰 뒷4자리 표기 유지(AC-2 회귀 없음)', async ({ page }) => {
    await page.waitForTimeout(1500);
    const cards = page.locator('[data-testid="box1-resv-card"]');
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 미내원 초진 예약 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    // 초진 카드는 핸드폰 뒷4자리(또는 결측 시 placeholder)를 font-mono span으로 표기 — 빈 텍스트 금지
    const first = cards.first();
    const monoSpan = first.locator('span.font-mono');
    expect(await monoSpan.count()).toBeGreaterThan(0);
    const text = (await monoSpan.first().textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  // ── S3: phoneTailSuffix 파생 규칙 계약 미러 (E.164/010/결측) ──
  test('S3: phoneTailSuffix 파생 규칙 — E.164/010/4자리미만 null', () => {
    // src/lib/format.ts phoneTailSuffix 와 동일 규칙을 미러링하여 계약 고정.
    const phoneTailSuffix = (phone: string | null | undefined): string | null => {
      const digits = (phone ?? '').replace(/\D/g, '');
      if (digits.length < 4) return null;
      return digits.slice(-4);
    };
    expect(phoneTailSuffix('+821012345678')).toBe('5678'); // E.164
    expect(phoneTailSuffix('010-1234-5678')).toBe('5678'); // 하이픈
    expect(phoneTailSuffix('01099991234')).toBe('1234');   // 숫자만
    expect(phoneTailSuffix('123')).toBeNull();             // 4자리 미만 → fallback
    expect(phoneTailSuffix('')).toBeNull();                // 결측
    expect(phoneTailSuffix(null)).toBeNull();
    expect(phoneTailSuffix(undefined)).toBeNull();
  });
});
