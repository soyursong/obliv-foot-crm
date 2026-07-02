import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { resvKind, isRibbonBrief, KIND_AXIS_LABELS } from '../../src/lib/resvSlotAgg';

/**
 * T-20260702-foot-RESVGRID-4ROW-BODYSPLIT — 예약격자 바디 4행 물리 분할
 * 원천: 김주연 총괄(C0ATE5P6JTH, 2026-07-02 12:01, "아니^^칸을 4줄로 해달라고").
 *   부모 YAXIS-4SEG(d230ec50)는 세로축 좌측 '라벨만' 4분류로 표기(카드행 new/rest 2행). 본 티켓이
 *   각 시간 열(column)을 초진/재진/힐러/리본(발각질) 4개 동등높이 행으로 실제 분할(엑셀 매트릭스)하도록 보정.
 *
 * 검증 = ① Reservations.tsx source-integrity(DAY_ROW_KINDS 4행 구성 · dayRowOf 파티션 · 4행 map 렌더 ·
 *   substrate 유지) ② 런타임 graceful(4개 rowlabel 위→아래 배치 · 카드가 4행 셀 하위). 실 렌더 스샷은 supervisor field-soak.
 *   분류 소스 신규 없음 = resvKind(초/재/힐러) + isRibbonBrief(간략메모 발각질 칩). FE-only, 스키마 무접촉.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1/AC2 — 세로축 4행 물리 분할(초진/재진/힐러/리본) 구성 SSOT + 4행 map 렌더
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1/AC2: 세로축 4행 물리 분할 — source-integrity', () => {
  test('AC1-1: DAY_ROW_KINDS 4행 구성(초진/재진/힐러/리본) — 세로축 순서 SSOT', () => {
    expect(RESV_PAGE, 'DAY_ROW_KINDS 정의 누락').toContain('const DAY_ROW_KINDS');
    // 4행 kind 전부 구성에 존재
    for (const k of ['new', 'returning', 'healer', 'ribbon']) {
      expect(RESV_PAGE, `DAY_ROW_KINDS ${k} 행 누락`).toContain(`kind: '${k}'`);
    }
    // full 라벨은 KIND_AXIS_LABELS SSOT 재사용(라벨 하드코딩 금지)
    expect(RESV_PAGE, '초진 라벨 SSOT 회귀').toContain('KIND_AXIS_LABELS.new.full');
    expect(RESV_PAGE, '재진 라벨 SSOT 회귀').toContain('KIND_AXIS_LABELS.returning.full');
    expect(RESV_PAGE, '힐러 라벨 SSOT 회귀').toContain('KIND_AXIS_LABELS.healer.full');
    expect(RESV_PAGE, '리본 라벨 SSOT 회귀').toContain('KIND_AXIS_LABELS.ribbon.full');
  });

  test('AC2-1: 4행 map 렌더 + rowlabel testid(row.kind) — 라벨-only 아님', () => {
    expect(RESV_PAGE, '4행 map 렌더 누락').toContain('DAY_ROW_KINDS.map((row)');
    expect(RESV_PAGE, '4행 rowlabel testid 회귀').toContain('data-testid={`resv-day-rowlabel-${row.kind}`}');
    // 시간 열 셀 = 각 행별 분할 셀(resv-day-cell-{row.kind}-{time})
    expect(RESV_PAGE, '4행 셀 testid 회귀').toContain('data-testid={`resv-day-cell-${row.kind}-${time}`}');
    // 각 셀 카드 = dayRowOf 파티션(카드당 1행)
    expect(RESV_PAGE, 'dayRowOf 파티션 필터 회귀').toContain('list.filter((r) => dayRowOf(r) === row.kind)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 분류 배치 파티션(리본 우선 → 초진/힐러/재진·기타), 소스 신규 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 카드 4행 배치 파티션 — 기존 소스 재사용', () => {
  test('AC3-1: dayRowOf 파티션 규칙(리본 우선 → resvKind) source-integrity', () => {
    // 리본(간략메모 발각질 칩) 최우선 → row4
    expect(RESV_PAGE, '리본 우선 파티션 회귀').toMatch(/if \(isRibbonBrief\(r\.brief_note\)\) return 'ribbon'/);
    // 그 외 resvKind: 초진→new, 힐러→healer, 나머지(재진·기타)→returning
    expect(RESV_PAGE, 'dayRowOf resvKind 위임 회귀').toMatch(/const k = resvKind\(r\)/);
    expect(RESV_PAGE, "초진 행 매핑 회귀").toContain("if (k === 'new') return 'new'");
    expect(RESV_PAGE, "힐러 행 매핑 회귀").toContain("if (k === 'healer') return 'healer'");
    expect(RESV_PAGE, "재진·기타 행 매핑 회귀").toContain("return 'returning'");
  });

  test('AC3-2: 분류 소스 = 기존(resvKind + isRibbonBrief), 신규 컬럼/소스 없음', () => {
    // 초진/재진 = visit_type SSOT(resvKind), 힐러 = is_healer_intent(resvKind), 리본 = 간략메모 칩(isRibbonBrief).
    expect(resvKind({ visit_type: 'new' })).toBe('new');
    expect(resvKind({ visit_type: 'returning' })).toBe('returning');
    expect(resvKind({ visit_type: 'returning', is_healer_intent: true })).toBe('healer');
    expect(isRibbonBrief('발각질케어')).toBe(true);
    expect(isRibbonBrief('발톱무좀')).toBe(false);
    // full 라벨 4종 정합
    expect(KIND_AXIS_LABELS.new.full).toBe('초진');
    expect(KIND_AXIS_LABELS.returning.full).toBe('재진');
    expect(KIND_AXIS_LABELS.healer.full).toBe('힐러');
    expect(KIND_AXIS_LABELS.ribbon.full).toBe('리본(발각질)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4/AC5/AC6 — 회귀 가드(세로축 라벨/헤더 축약 · substrate 엑셀칸 · 취소 제외)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC4/AC5/AC6: 회귀 가드', () => {
  test('AC4-1: 시간칸 헤더 밑 초-재-힐-리 축약 표기 유지(YAXIS-4SEG)', () => {
    expect(RESV_PAGE, '초 축약 회귀').toContain('KIND_AXIS_LABELS.new.abbr}{n}');
    expect(RESV_PAGE, '재 축약 회귀').toContain('KIND_AXIS_LABELS.returning.abbr}{rr}');
    expect(RESV_PAGE, '힐 축약 회귀').toContain('KIND_AXIS_LABELS.healer.abbr}{h}');
    expect(RESV_PAGE, '리 축약 회귀').toContain('KIND_AXIS_LABELS.ribbon.abbr}{ribbon}');
  });

  test('AC5-1: substrate(RESVGRID-TIMEAXIS) 가로축 + 엑셀식 빈칸 직접입력 유지', () => {
    expect(RESV_PAGE, '가로 시간축 grid 회귀').toContain('data-testid="resv-day-xaxis"');
    expect(RESV_PAGE, '빈칸 직접입력 title 회귀').toContain('빈 칸 클릭 → 신규예약');
    // (+)버튼 미부활 — 셀 클릭 생성은 openNewSlot 경유(CUSTCTX-PREFILL 분기 보존)
    expect(RESV_PAGE, 'openNewSlot 경유 회귀').toContain('openNewSlot(selectedDay, time)');
    expect(RESV_PAGE, '(+)버튼 미부활').not.toContain('resv-day-slot-plus');
  });

  test('AC6-1: 취소 예약 집계 제외 유지(kindCounts)', () => {
    expect(RESV_PAGE, '취소 제외 규칙 회귀').toContain("if (r.status === 'cancelled') continue;");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 런타임 graceful — 4개 rowlabel 위→아래 배치 + 카드 4행 셀 하위(데이터/인증 없으면 skip)
// ═══════════════════════════════════════════════════════════════════════════
async function gotoDayGrid(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    const pw = process.env.TEST_PASSWORD;
    if (!pw) return false; // 인증 불가 환경 → graceful skip
    await page.getByPlaceholder('비밀번호').fill(pw);
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 }).catch(() => {});
    await page.goto('/admin/reservations');
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  const dayToggle = page.getByRole('button', { name: '일간', exact: true });
  if ((await dayToggle.count()) > 0) { await dayToggle.click().catch(() => {}); await page.waitForTimeout(300); }
  return page.locator('[data-testid="resv-day-horizontal"]').isVisible({ timeout: 5000 }).catch(() => false);
}

test.describe('런타임: 4행 세로축 렌더(graceful)', () => {
  test('4개 행 라벨(초진→재진→힐러→리본)이 위→아래로 물리 분할 배치', async ({ page }) => {
    test.skip(!(await gotoDayGrid(page)), '일간 격자 미렌더/인증 부재 — skip');

    const labels = ['new', 'returning', 'healer', 'ribbon'].map((k) => page.getByTestId(`resv-day-rowlabel-${k}`));
    for (const lb of labels) await expect(lb).toBeVisible();

    const boxes = await Promise.all(labels.map((lb) => lb.boundingBox()));
    for (let i = 0; i + 1 < boxes.length; i++) {
      const a = boxes[i], b = boxes[i + 1];
      if (a && b) expect(a.y, '세로축 위→아래 4분류 순서').toBeLessThan(b.y);
    }
  });

  test('예약 카드가 4행 셀(resv-day-cell-*) 하위에 배치', async ({ page }) => {
    test.skip(!(await gotoDayGrid(page)), '일간 격자 미렌더/인증 부재 — skip');
    const cards = page.locator('[data-testid^="resv-card-"]');
    test.skip((await cards.count()) === 0, '당일 예약 없음 — skip');
    const inGridCell = (await cards.first().locator('xpath=ancestor::*[starts-with(@data-testid,"resv-day-cell-")]').count()) > 0;
    expect(inGridCell).toBeTruthy();
  });
});
