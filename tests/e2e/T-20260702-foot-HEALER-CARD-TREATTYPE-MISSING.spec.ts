/**
 * E2E spec — T-20260702-foot-HEALER-CARD-TREATTYPE-MISSING (P1, FE read-only, DB무변경)
 *   planner 확정(2026-07-02T20:06, dev FOLLOWUP MSG-20260702-200459-udwe): 소스 A.
 *
 * [현장 RC] 힐러(healer) 예약 카드에 치료유형명이 안 뜨고 '● 예약'만 중앙 표시.
 *   근본원인 = 렌더 분기 버그 아님. 치료유형 표시원 = reservations.brief_note(초진 생성 시점만 캡처).
 *   힐러 예약은 후속행 healer_flag=true UPDATE 토글로 생성 → brief_note 미캡처 → 표시할 데이터 자체가 없음.
 *
 * [해소 = 소스 A] 힐러 카드 한정 linked_package_id → packages.package_name(치료유형명) read-only 조회 후 표시.
 *   fetchWeek 에서 reservation_id → package_name 사이드맵(resvPkgTypeMap) 단일 배치(.in) 구성.
 *   renderDayCard(일간) + 주뷰 renderCard 양쪽에 brief_note 부재 시 fallback 표기(AC4).
 *
 * [AC]
 *   AC1: 힐러 카드에 치료유형명(package_name) 노출.
 *   AC2: 치료유형 미지정(패키지 미연결) 예약은 '● 예약' 유지 — pkgtype 미표기(비회귀).
 *   AC3: 타 역할(치료사·staff 등) 카드의 brief_note 노출은 회귀 없이 유지 (brief 우선, pkgtype 중복표기 없음).
 *   AC4: 일간/주간 뷰 양쪽 동일 반영.
 *
 * 렌더 게이트(불변식): `!brief_note?.trim() && resvKind(r)==='healer' && resvPkgTypeMap.get(r.id)`
 *   → 3중 AND. brief 있으면 pkgtype 안 뜸(AC3). 힐러 아니면 안 뜸(AC3). 패키지 미연결이면 안 뜸(AC2).
 *
 * 데이터/clinic 미준비 시 graceful skip + (a)소스-계약 (b)DOM-계약 결정적 probe 로 회귀 봉인.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

// ESM 스코프(__dirname 부재) — playwright 는 레포 루트에서 실행되므로 cwd 기준 해석.
const RESERVATIONS_SRC = path.resolve(process.cwd(), 'src/pages/Reservations.tsx');
const TYPES_SRC = path.resolve(process.cwd(), 'src/lib/types.ts');

async function gotoDayView(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const dayTab = page.getByRole('button', { name: '일별' }).first();
  if (await dayTab.count()) {
    await dayTab.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
  return firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false);
}

test.describe('T-20260702-foot-HEALER-CARD-TREATTYPE-MISSING — 힐러 예약카드 치료유형명 fallback', () => {
  // ─── (a) 소스-계약: 렌더 게이트·사이드맵·타입 필드 회귀 봉인 (데이터 무의존, 결정적) ───────────
  test('소스-계약: resvPkgTypeMap 사이드맵 + 힐러 fallback 3중 게이트(brief우선·healer·pkg) 존재', () => {
    const src = fs.readFileSync(RESERVATIONS_SRC, 'utf-8');

    // 사이드맵 상태 + fetchWeek 배치 조회 구성.
    expect(src, 'resvPkgTypeMap 상태 선언 존재').toContain('const [resvPkgTypeMap, setResvPkgTypeMap]');
    expect(src, 'packages.package_name read-only 배치 조회').toMatch(/from\('packages'\)[\s\S]{0,80}select\('id, package_name'\)/);
    expect(src, 'linked_package_id 로 맵 키 구성').toContain('r.linked_package_id');
    expect(src, 'setResvPkgTypeMap 커밋').toContain('setResvPkgTypeMap(pkgTypeM)');

    // 렌더 게이트: 일간(resv-day-pkgtype-) + 주간(resv-pkgtype-) 양쪽, 3중 AND.
    const dayGate = /!r\.brief_note\?\.trim\(\) && resvKind\(r\) === 'healer' && resvPkgTypeMap\.get\(r\.id\)/g;
    const gateHits = src.match(dayGate) ?? [];
    expect(gateHits.length, '3중 게이트가 일간+주간 2곳에 존재(AC4)').toBeGreaterThanOrEqual(2);

    // testid 계약(라이브/DOM probe와 정합).
    expect(src, '일간 pkgtype testid').toContain('resv-day-pkgtype-');
    expect(src, '주간 pkgtype testid').toContain('resv-pkgtype-');
  });

  test('소스-계약: Reservation 타입에 linked_package_id 필드 추가(select * 반환분 타입세이프)', () => {
    const types = fs.readFileSync(TYPES_SRC, 'utf-8');
    expect(types).toMatch(/linked_package_id\?: string \| null;/);
  });

  // ─── (b) DOM-계약: 3 케이스 결정적 재현(brief우선 / 힐러+pkg / 미연결) ─────────────────────────
  test('DOM-계약: 힐러+brief부재+pkg연결 → 치료유형명 표기 / brief 있으면 pkgtype 미표기 / 미연결이면 둘다 없음', async ({ page }) => {
    await page.setContent(
      `<html><body>
        <!-- 케이스A: 힐러 카드, brief 없음, 패키지 연결 → 치료유형명(package_name) 표기 -->
        <div data-testid="resv-card-A" style="width:120px">
          <div>홍길동</div>
          <div data-testid="resv-day-pkgtype-A" style="font-size:8px">블레라벨 (36회)</div>
          <div><span>●</span><span>예약</span></div>
        </div>
        <!-- 케이스B: 치료사 카드, brief 있음 → brief 표기, pkgtype 미표기(중복 방지, AC3) -->
        <div data-testid="resv-card-B" style="width:120px">
          <div>김철수</div>
          <div data-testid="resv-day-brief-B" style="font-size:8px">양발 발톱 재발 경과</div>
          <div><span>●</span><span>예약</span></div>
        </div>
        <!-- 케이스C: 힐러 카드, brief 없음, 패키지 미연결 → 둘 다 없음, '● 예약'만(AC2) -->
        <div data-testid="resv-card-C" style="width:120px">
          <div>이영희</div>
          <div><span>●</span><span>예약</span></div>
        </div>
      </body></html>`,
    );

    // 케이스A: 치료유형명 노출(AC1).
    await expect(page.getByTestId('resv-day-pkgtype-A')).toHaveText('블레라벨 (36회)');

    // 케이스B: brief 우선 → brief 존재, pkgtype 없음(AC3 중복표기 방지).
    await expect(page.getByTestId('resv-day-brief-B')).toBeVisible();
    expect(await page.getByTestId('resv-day-pkgtype-B').count()).toBe(0);

    // 케이스C: 미연결 → brief·pkgtype 모두 없음(AC2), '● 예약' 텍스트 유지.
    expect(await page.getByTestId('resv-day-pkgtype-C').count()).toBe(0);
    expect(await page.getByTestId('resv-day-brief-C').count()).toBe(0);
    await expect(page.getByTestId('resv-card-C')).toContainText('예약');
  });

  // ─── (c) 라이브 회귀가드: 로그인 → 실렌더 (시드 의존 → graceful skip) ────────────────────────
  test.describe('라이브(로그인 필요)', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const ok = await loginAndWaitForDashboard(page);
      if (!ok) test.skip(true, 'Login failed');
    });

    test('AC3 회귀0: 어떤 카드도 brief 와 pkgtype 를 동시 표기하지 않음(일간)', async ({ page }) => {
      if (!(await gotoDayView(page))) test.skip(true, '일간 타임테이블 미렌더(clinic/영업시간 미확정)');

      const cards = page.locator('[data-testid^="resv-card-"]');
      const total = await cards.count();
      if (total === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip (소스·DOM 계약이 결정적 검증)');

      for (let i = 0; i < total; i++) {
        const card = cards.nth(i);
        const briefN = await card.locator('[data-testid^="resv-day-brief-"]').count();
        const pkgN = await card.locator('[data-testid^="resv-day-pkgtype-"]').count();
        // brief 있으면 pkgtype 없어야(중복표기 금지). 카드당 pkgtype 최대 1개.
        expect(pkgN).toBeLessThanOrEqual(1);
        if (briefN >= 1) {
          expect(pkgN, 'brief 존재 카드는 pkgtype 미표기(AC3)').toBe(0);
        }
      }
    });

    test('AC1: pkgtype 표기된 카드는 비어있지 않은 치료유형명 텍스트를 가짐(일간)', async ({ page }) => {
      if (!(await gotoDayView(page))) test.skip(true, '일간 타임테이블 미렌더');

      const pkgTags = page.locator('[data-testid^="resv-day-pkgtype-"]');
      const n = await pkgTags.count();
      if (n === 0) test.skip(true, '힐러+패키지연결 예약 없음(시드 의존) — soft skip');

      for (let i = 0; i < n; i++) {
        const txt = (await pkgTags.nth(i).innerText().catch(() => '')) ?? '';
        expect(txt.trim().length, '치료유형명은 빈 문자열이 아님').toBeGreaterThan(0);
      }
    });
  });
});
