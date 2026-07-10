/**
 * E2E Spec — T-20260710-foot-VISITHIST-DOCSTATUS-DOCTORCOUNT (김주연 총괄, C0ATE5P6JTH)
 *
 * 치료테이블 > 진료 환자 이력 탭(4탭 중 기본 'history'). 상위 티켓
 * T-20260710-foot-TREATHIST-DOCREQ-DOCTORCOUNT 의 코디팀 프레이밍 delta:
 *   요구①(집계보강): 상단 '소견·진단서 금일 신청 N건 · 발행 M건' 한눈 요약(코디팀 오늘 신청/발행 건수 확인).
 *   요구②: 진료의별 금일 담당 환자수 — 상위 티켓에서 이미 충족(회귀 유지).
 *
 * 착수 결정(note, discovery-first):
 *   1. db_change=false — 발행=form_submissions(published, doc_kind='opinion_doc') / 신청=form_submissions
 *      staff_consult 요청 row 재사용. 신규 컬럼/테이블/enum 0 → data-architect CONSULT 불요.
 *   2. ② 집계 grain = 실제 진료(진료콜 등재 내원 status_flag purple|pink), 예약 grain 아님.
 *   3. ① 신청모델 = opinionRequest.ts(form_submissions staff_consult) 재사용. KOHEXAM check_in_services
 *      koh_requested 모델 미공유·신규 모델 0(별도 저장소 신설 금지 준수).
 *
 * 구성:
 *   A. 순수 로직 단언 — 컴포넌트가 실제 소비하는 동일 함수(computeDocStatusSummary)를 직접 import(drift 방지).
 *      신청 ≠ 발행 독립 축(AC1/AC4) + 0 안전(AC5) 판정.
 *   B. 브라우저 재현 — /admin/treatment-table → 진료 환자 이력 탭 → (명단 有 시) 신청/발행 집계 요약 + 진료의별 요약 가시화.
 *
 * 실행: npx playwright test T-20260710-foot-VISITHIST-DOCSTATUS-DOCTORCOUNT.spec.ts
 */

import { test, expect } from '@playwright/test';
import { computeDocStatusSummary } from '../../src/components/treatment/DoctorHistorySection';

// ─── A. 순수 로직 (시나리오2·3 / AC-1·AC-4·AC-5) ──────────────────────────────

test.describe('요구①(집계보강) — 소견·진단서 금일 신청/발행 집계(computeDocStatusSummary)', () => {
  test('신청·발행 독립 카운트 — 신청 N건 ≠ 발행 M건 (AC-1/AC-4)', () => {
    const rows = [
      { docRequested: true, opinionIssued: false },  // 신청만(대기)
      { docRequested: true, opinionIssued: true },   // 신청+발행
      { docRequested: false, opinionIssued: true },  // 원장 직접 발행(신청 없이)
      { docRequested: false, opinionIssued: false }, // 해당 없음
    ];
    const s = computeDocStatusSummary(rows);
    expect(s.requestedCount).toBe(2); // 신청 O = 2
    expect(s.issuedCount).toBe(2);    // 발행 O = 2
    expect(s.total).toBe(4);          // 명단 총원
    // 두 축은 별개 — 신청건수와 발행건수가 서로 종속되지 않음.
    expect(s.requestedCount === s.issuedCount).toBe(true); // 우연히 같을 뿐, 독립 계산
  });

  test('시나리오3-2 — 신청 있으나 미발행: 신청 O·발행 X 정확 구분', () => {
    const rows = [
      { docRequested: true, opinionIssued: false },
      { docRequested: true, opinionIssued: false },
      { docRequested: true, opinionIssued: false },
    ];
    const s = computeDocStatusSummary(rows);
    expect(s.requestedCount).toBe(3);
    expect(s.issuedCount).toBe(0); // 신청은 발행으로 자동 승격되지 않음
  });

  test('발행만 있고 신청 0 — 원장 직접 발행 케이스', () => {
    const rows = [
      { docRequested: false, opinionIssued: true },
      { docRequested: false, opinionIssued: true },
    ];
    const s = computeDocStatusSummary(rows);
    expect(s.requestedCount).toBe(0);
    expect(s.issuedCount).toBe(2);
  });

  test('시나리오3-1 / AC-5 — 빈 명단(0명) 안전 집계 → 0/0/0 (에러 없음)', () => {
    const s = computeDocStatusSummary([]);
    expect(s).toEqual({ requestedCount: 0, issuedCount: 0, total: 0 });
  });

  test('모두 신청+발행 완료 → N=M=total', () => {
    const rows = [
      { docRequested: true, opinionIssued: true },
      { docRequested: true, opinionIssued: true },
    ];
    const s = computeDocStatusSummary(rows);
    expect(s.requestedCount).toBe(2);
    expect(s.issuedCount).toBe(2);
    expect(s.total).toBe(2);
  });
});

// ─── B. 브라우저 재현 (Radix Tabs lazy-mount → 탭 클릭) ─────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@medibuilder.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ??
        (() => {
          throw new Error('TEST_PASSWORD env required (no plaintext fallback)');
        })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 }).catch(() => {});
  }
}

test.describe('브라우저 재현 — 진료 환자 이력 탭 신청/발행 집계 + 진료의별 요약', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  // 시나리오1(요구②) + 시나리오2(요구①) 통합 재현. 당일 데이터 유무 무관 프레임 단언.
  test('탭 클릭 → 신청/발행 집계 요약 + 진료의별 요약 프레임(명단 有 시)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    const tabs = page.getByTestId('treatment-section-tabs');
    await expect(tabs).toBeVisible({ timeout: 10000 });

    const historyTab = page.getByTestId('tab-doctor-history');
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    const section = page.getByTestId('doctor-history-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 명단 有 → 집계 요약 + 진료의별 요약 + 신청/발행 per-row. 명단 無 → 빈 상태 메시지. 둘 중 하나 반드시 렌더(AC-5).
    const table = page.getByTestId('doctor-history-table');
    const empty = page.getByTestId('doctor-history-empty');
    await expect(table.or(empty)).toBeVisible({ timeout: 10000 });

    if (await table.isVisible().catch(() => false)) {
      // 요구①(집계보강): 소견·진단서 금일 신청/발행 집계 바 + 각 카운트 칩
      const docStatus = page.getByTestId('dh-doc-status-summary');
      await expect(docStatus).toBeVisible();
      const requested = page.getByTestId('dh-doc-status-requested');
      const issued = page.getByTestId('dh-doc-status-issued');
      await expect(requested).toBeVisible();
      await expect(issued).toBeVisible();

      // 신청/발행 카운트는 숫자(data-count) — 신청 ≠ 발행 독립 축이므로 각각 존재.
      const reqCount = Number(await requested.getAttribute('data-count'));
      const issCount = Number(await issued.getAttribute('data-count'));
      expect(Number.isNaN(reqCount)).toBe(false);
      expect(Number.isNaN(issCount)).toBe(false);
      expect(reqCount).toBeGreaterThanOrEqual(0);
      expect(issCount).toBeGreaterThanOrEqual(0);

      // 요구② 회귀: 진료의별 금일 담당 요약(상위 티켓) 유지
      await expect(page.getByTestId('dh-doctor-count-summary')).toBeVisible();
      // 요구① per-row 회귀: 신청/발행 O/X 배지 유지
      await expect(page.getByTestId('dh-opinion-request').first()).toBeVisible();
      await expect(page.getByTestId('dh-opinion-issue').first()).toBeVisible();
    }
  });
});
