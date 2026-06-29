/**
 * T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY
 *
 * 현상: 초진 접수 환자가 통합 시간표(Timeline)에서 재진 구역에 표시.
 * 근본(데이터 확정): 시나리오 A — ci.visit_type='new' 인데 매칭 reservation.visit_type='returning'.
 *   기존 routing이 r.visit_type 우선 → 초진 환자를 재진 구역에 배치.
 * Fix(Option A): 매칭 체크인이 있으면 ci.visit_type 우선, 없으면 r.visit_type 폴백
 *   = timelineVisitType(ci?.visit_type, r.visit_type). 워크인 분기와 일관.
 *
 * AC-2: 확정 시나리오(A) 최소범위 fix (표시 routing, db_change=false).
 * AC-3: 회귀 0 — 정상 재진 환자·워크인 분류 유지.
 * AC-4: 4조합(초진/재진 × 매칭/워크인) 전수 검증.
 *
 * 분류 로직(timelineVisitType)을 순수 함수로 결정적으로 검증하고,
 * 라이브 렌더 스모크로 통합 시간표가 정상 렌더됨을 확인한다.
 */
import { test, expect } from '@playwright/test';
import { timelineVisitType } from '../../src/lib/timeline-routing';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── 타임라인 routing 재현: effVisitType → 어느 구역(new/returning)에 배치되는가 ──
// Dashboard.tsx 예약 루프(L1989~) + 워크인 루프(L2047~)의 분류 기준과 동일.
type Zone = 'new' | 'returning';
function timelineZone(
  ciVisitType: 'new' | 'returning' | 'experience' | null | undefined,
  resvVisitType: 'new' | 'returning' | 'experience',
): Zone {
  const eff = timelineVisitType(ciVisitType, resvVisitType);
  // Dashboard 2분기: effVisitType==='new' → 초진 구역, 그 외(returning/experience) → 재진 구역.
  // (fix는 'new' 판정의 입력만 ci 우선으로 바꿀 뿐, 2분기 구조는 불변)
  return eff === 'new' ? 'new' : 'returning';
}
function walkinZone(ciVisitType: 'new' | 'returning' | 'experience'): Zone {
  return ciVisitType === 'new' ? 'new' : 'returning';
}

test.describe('T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY (분류 로직)', () => {
  // ── AC-4 조합 1: 초진 × 매칭 (ci=new, r=returning) — 버그 케이스. 초진 구역이어야 함 ──
  test('AC-4-1: 초진 체크인이 재진 예약에 매칭돼도 초진 구역(new)에 배치된다 [버그 fix]', () => {
    expect(timelineZone('new', 'returning')).toBe('new');
    // 예약도 초진인 정상 매칭도 당연히 초진
    expect(timelineZone('new', 'new')).toBe('new');
  });

  // ── AC-4 조합 2: 재진 × 매칭 (ci=returning) — 재진 구역 유지 (회귀 0) ──
  test('AC-4-2: 재진 체크인은 재진 구역(returning)에 유지된다 [회귀]', () => {
    expect(timelineZone('returning', 'returning')).toBe('returning');
    // ci=returning 이면 예약이 new여도 ci 권위 기준 → 재진 (워크인과 일관)
    expect(timelineZone('returning', 'new')).toBe('returning');
  });

  // ── AC-4 조합 3: 초진 × 워크인 (예약 없음, ci=new) — 초진 구역 ──
  test('AC-4-3: 초진 워크인은 초진 구역(new)에 배치된다', () => {
    expect(walkinZone('new')).toBe('new');
  });

  // ── AC-4 조합 4: 재진 × 워크인 (예약 없음, ci=returning) — 재진 구역 ──
  test('AC-4-4: 재진 워크인은 재진 구역(returning)에 배치된다', () => {
    expect(walkinZone('returning')).toBe('returning');
  });

  // ── AC-2 핵심: 매칭/워크인 일관성 — 동일 ci.visit_type 이면 예약 유무와 무관하게 같은 구역 ──
  test('AC-2: 동일 체크인 visit_type 이면 매칭/워크인 routing 결과가 같다 (일관성)', () => {
    for (const ci of ['new', 'returning'] as const) {
      const matched = timelineZone(ci, ci === 'new' ? 'returning' : 'new'); // 예약은 반대로 꼬아도
      const walkin = walkinZone(ci);
      expect(matched).toBe(walkin);
    }
  });

  // ── ci 없음(셀프접수 전): 예약 visit_type 폴백 (기존 동작 유지) ──
  test('AC-3: 체크인 없는 예약은 예약 visit_type으로 분류된다 (폴백 유지)', () => {
    expect(timelineZone(null, 'new')).toBe('new');
    expect(timelineZone(undefined, 'returning')).toBe('returning');
    // 순수 함수 직접 검증
    expect(timelineVisitType(undefined, 'new')).toBe('new');
    expect(timelineVisitType('new', 'returning')).toBe('new');
    expect(timelineVisitType('returning', 'new')).toBe('returning');
  });

  // ── 체험(experience) 동선: 기존 2분기 동작 보존 (회귀 0) ──
  test('체험(experience)은 재진측 구역 분기 유지 — 기존 동작 보존 (회귀 0)', () => {
    // Dashboard 2분기는 'new'만 초진 구역, 그 외(returning/experience)는 재진 구역측 분기.
    // fix는 이 구조를 바꾸지 않으므로 experience 분류 결과 불변.
    expect(timelineZone('experience', 'returning')).toBe('returning');
    expect(timelineZone('experience', 'new')).toBe('returning');
  });
});

test.describe('T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY (라이브 렌더 스모크)', () => {
  async function loginIfNeeded(page: import('@playwright/test').Page) {
    const loginInput = page.getByPlaceholder('이메일');
    if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
      await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
      await page.getByRole('button', { name: '로그인' }).click();
      await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
    }
  }

  test('통합 시간표가 초진/재진 슬롯과 함께 정상 렌더된다 (fix 후 오류 없음)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('timeline-time-col')).toBeVisible({ timeout: 8000 });
    expect(await page.getByTestId('timeline-slot-new').count()).toBeGreaterThan(0);
    expect(await page.getByTestId('timeline-slot-ret').count()).toBeGreaterThan(0);

    // routing 관련 런타임 오류 없음
    const routingErrors = errors.filter((e) =>
      e.includes('visit_type') || e.includes('timelineVisitType') || e.includes('effVisitType'),
    );
    expect(routingErrors).toHaveLength(0);
  });
});
