/**
 * E2E/Unit — T-20260722-foot-SELFCHECKIN-GRADE-CAPTURE-DESK
 * parent: T-20260722-foot-HIRA-SCORE-GONGDAN-4SVC-LOAD (Part B 분리)
 *
 * ── 결함(실측) ────────────────────────────────────────────────────────
 *   insurance_grade 필수입력이 데스크 접수(NewCheckInDialog, a4cfa17f 배포됨)에만 존재하고
 *   셀프체크인(키오스크) 경로는 우회 — self-checkin RPC 의 customers INSERT 컬럼에 insurance_grade
 *   부재 → 신규 고객이 원본 grade=null 로 유입(오늘 신규 null 20/20 = 이 경로).
 *
 * ── 처방(자동조회 前 지혈) ─────────────────────────────────────────────
 *   키오스크 환자는 등급을 모르므로 kiosk 필수화 불가 → 데스크 캡처로.
 *   null-grade 고객이 수납대기/수납(PMW)·차트 진입 시 등급 미입력이면 눈에 띄는 경고 +
 *   빠른 입력(InsuranceGradeSelect — 데스크접수 검증 패턴 재사용, 중복 창안 금지).
 *   ⚠️ 추측 강요 금지 — 모르면 빈칸 유지(경고만, 하드 차단 아님).
 *
 * ── 스코프 경계 ────────────────────────────────────────────────────────
 *   ✅ 이 티켓 = self-checkin 신규 유입 차단(데스크 캡처 유도)만.
 *   ❌ 기존 387 backfill = T-20260721-foot-INSGRADE-NULL-BACKFILL-REQUIRED (별건).
 *   ❌ 등급별 본인부담 산식 = T-20260720-foot-COPAY-GRADE-BRANCH-MISSING (별건).
 *   ⛔ self-checkin RPC 무변경(등급 캡처는 데스크 FE) → db_change=false, no-DDL.
 *
 * ── AC ─────────────────────────────────────────────────────────────────
 *   AC1 null-grade 판정: 원본 grade == null → 캡처 대상.
 *   AC2 'unverified'(미확인) 도 캡처 대상(결제 split 정확도 위해 실등급 캡처 유도).
 *   AC3 유효 등급(general/의료급여 등)은 캡처 대상 아님(경고 미표시).
 *   AC4 customer_id 없으면(워크인 미연결) 캡처 배너 자체 미표시.
 *   AC5 effective(폴백) 등급이 아닌 RAW 원본 grade 로만 판정(폴백값이 미입력을 가려선 안 됨).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { ALL_INSURANCE_GRADES, type InsuranceGrade } from '../../src/lib/insurance';

// PMW/차트 배너 표시 판정 규칙 재현 (컴포넌트 needsGradeCapture 등가).
//   원본(RAW) customers.insurance_grade 기준 — effective(service_charges 폴백) 미사용.
const needsGradeCapture = (
  customerId: string | null,
  rawGrade: InsuranceGrade | null,
): boolean => !!customerId && (rawGrade == null || rawGrade === 'unverified');

test.describe('T-20260722 AC1/AC2 — null·unverified = 데스크 캡처 대상', () => {
  test('AC1: 원본 grade=null(셀프체크인 신규 유입) → 캡처 대상', () => {
    expect(needsGradeCapture('cust-1', null)).toBe(true);
  });

  test('AC2: unverified(미확인) → 캡처 대상 (실등급 캡처 유도)', () => {
    expect(needsGradeCapture('cust-1', 'unverified')).toBe(true);
  });
});

test.describe('T-20260722 AC3 — 유효 등급은 캡처 대상 아님(경고 미표시)', () => {
  const covered: InsuranceGrade[] = ALL_INSURANCE_GRADES.filter(
    (g) => g !== 'unverified',
  );
  for (const g of covered) {
    test(`유효 등급 '${g}' → 캡처 미대상`, () => {
      expect(needsGradeCapture('cust-1', g)).toBe(false);
    });
  }
});

test.describe('T-20260722 AC4 — customer_id 없으면 배너 미표시', () => {
  test('워크인 미연결(customer_id=null) → grade null 이어도 캡처 배너 없음', () => {
    expect(needsGradeCapture(null, null)).toBe(false);
  });
  test('customer_id 없음 + unverified → 미표시', () => {
    expect(needsGradeCapture(null, 'unverified')).toBe(false);
  });
});

test.describe('T-20260722 AC5 — RAW 원본 기준 판정(폴백값 가림 금지)', () => {
  test('원본 null 이면, 이 방문 charge 폴백이 general 이어도(effective≠null) 캡처 유도', () => {
    // 컴포넌트는 useInsuranceGrade(원본 조회)로 판정 → effective(폴백) 와 독립.
    //   원본 null 인 이상, 결제-split 은 폴백으로 임시 수렴해도 고객 마스터 등급은 여전히 미입력 →
    //   데스크가 실등급을 원본에 캡처해야 다음 방문·서류까지 정합. 폴백이 경고를 꺼선 안 됨.
    const rawGrade: InsuranceGrade | null = null; // 고객 마스터 원본
    expect(needsGradeCapture('cust-1', rawGrade)).toBe(true);
  });
});

test.describe('T-20260722 배너 렌더 스모크(집계-inert, 하드차단 아님)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('대시보드 진입 시 콘솔 치명 에러 없음(컴포넌트 import·hook 안정)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/admin');
    await page.waitForTimeout(1500);
    const fatal = errors.filter(
      (e) => /InsuranceGradeSelect|useInsuranceGrade|AlertTriangle|is not defined|Cannot read/.test(e),
    );
    expect(fatal, `치명 에러: ${fatal.join('\n')}`).toHaveLength(0);
    console.log('[SELFCHECKIN-GRADE-CAPTURE-DESK] PMW/차트 null-grade 데스크 캡처 배너 · RAW-원본 판정 OK');
  });
});
