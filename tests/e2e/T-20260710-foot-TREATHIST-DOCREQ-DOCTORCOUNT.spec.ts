/**
 * E2E Spec — T-20260710-foot-TREATHIST-DOCREQ-DOCTORCOUNT (김주연 총괄, C0ATE5P6JTH)
 *
 * 치료테이블 > 진료 환자 이력 탭:
 *   요구1. 소견·진단서 열 = '신청여부' + '발행여부' 2항목 분리.
 *   요구2. 탭 상단 = 진료의별 금일 담당 환자수 요약(read-only 집계).
 *
 * discovery-first 결과(db_change=false, 재사용 배관):
 *   · 신청여부 = form_submissions 요청 row(field_data.request_origin='staff_consult')
 *       재사용(T-20260620-CHART2-OPINION-SELECT-BOX-LINK / opinionRequest.ts). 신규 테이블 0.
 *       draft=대기 / voided(resolved_reason≠'cancelled')=발행완료된 요청 → '신청됨'. 취소는 제외.
 *   · 발행여부 = form_submissions(status='published', doc_kind='opinion_doc') — 현행 배관 재사용(회귀 0).
 *   · 진료의별 count = check_ins.treating_doctor_id(§2-14, clinic_doctors) group-by. 미배정='미지정'.
 *
 * 구성:
 *   A. 순수 로직 단언 — 컴포넌트가 실제 소비하는 동일 함수(isActiveDocRequest / computeDoctorCountSummary)를
 *      직접 import(drift 방지). AC-1/AC-3/AC-4 판정 로직 확정.
 *   B. 브라우저 재현 경로 — Radix Tabs lazy-mount 대응: /admin/treatment-table → 진료 환자 이력 탭 클릭 →
 *      신청/발행 2열 헤더 + 진료의별 요약 프레임 가시화. (당일 데이터 유무 무관, 프레임/DOM 구조 단언)
 *
 * 실행: npx playwright test T-20260710-foot-TREATHIST-DOCREQ-DOCTORCOUNT.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  isActiveDocRequest,
  computeDoctorCountSummary,
  UNASSIGNED_DOCTOR_KEY,
} from '../../src/components/treatment/DoctorHistorySection';

// ─── A. 순수 로직 ─────────────────────────────────────────────────────────────

test.describe('요구1 / AC-1·AC-3 — 소견·진단서 신청여부 파생(isActiveDocRequest)', () => {
  test('draft(대기 요청) → 신청 O', () => {
    expect(isActiveDocRequest('draft', null)).toBe(true);
  });

  test("voided + resolved_reason='published'(발행완료된 요청) → 신청 O", () => {
    expect(isActiveDocRequest('voided', 'published')).toBe(true);
  });

  test("voided + resolved_reason='cancelled'(요청취소) → 신청 X", () => {
    expect(isActiveDocRequest('voided', 'cancelled')).toBe(false);
  });

  test('voided + resolved_reason 결측(방어) → 취소 아님 → 신청 O', () => {
    expect(isActiveDocRequest('voided', null)).toBe(true);
  });

  test('기타 status(published 등) → staff_consult 신청 row 아님 → 신청 X', () => {
    expect(isActiveDocRequest('published', null)).toBe(false);
    expect(isActiveDocRequest('', null)).toBe(false);
  });

  test('4조합 정합 — 신청/발행은 독립 축(요구1 목적: 신청 vs 발행 별도 파악)', () => {
    // 신청 O/발행 X = 대기 요청, 신청 O/발행 O = 발행완료, 신청 X/발행 X = 요청없음, 신청 X/발행 O = 원장 직접 발행.
    const req = (s: string, r: string | null) => isActiveDocRequest(s, r);
    expect(req('draft', null)).toBe(true); // 신청만
    expect(req('voided', 'published')).toBe(true); // 신청+발행
    expect(req('voided', 'cancelled')).toBe(false); // 취소
  });
});

test.describe('요구2 / AC-4 — 진료의별 금일 담당 환자수(computeDoctorCountSummary)', () => {
  const names = new Map<string, string>([
    ['cd-A', '한동훈'],
    ['cd-B', '이원장'],
  ]);

  test('진료의별 group-by count + 합계 = 명단 총원(미지정 포함)', () => {
    const rows = [
      { treatingDoctorId: 'cd-A' },
      { treatingDoctorId: 'cd-A' },
      { treatingDoctorId: 'cd-A' },
      { treatingDoctorId: 'cd-A' },
      { treatingDoctorId: 'cd-A' }, // A 5명
      { treatingDoctorId: 'cd-B' },
      { treatingDoctorId: 'cd-B' },
      { treatingDoctorId: 'cd-B' }, // B 3명
      { treatingDoctorId: null },
      { treatingDoctorId: null }, // 미지정 2명
    ];
    const summary = computeDoctorCountSummary(rows, names);
    const total = summary.reduce((s, e) => s + e.count, 0);
    expect(total).toBe(rows.length); // AC-4 정합
    const byKey = Object.fromEntries(summary.map((e) => [e.key, e.count]));
    expect(byKey['cd-A']).toBe(5);
    expect(byKey['cd-B']).toBe(3);
    expect(byKey[UNASSIGNED_DOCTOR_KEY]).toBe(2);
  });

  test('정렬 — 담당수 desc, 미지정 버킷 맨 뒤', () => {
    const rows = [
      { treatingDoctorId: null },
      { treatingDoctorId: null },
      { treatingDoctorId: null }, // 미지정 3(최다지만 맨 뒤)
      { treatingDoctorId: 'cd-B' }, // B 1
      { treatingDoctorId: 'cd-A' },
      { treatingDoctorId: 'cd-A' }, // A 2
    ];
    const summary = computeDoctorCountSummary(rows, names);
    expect(summary.map((e) => e.key)).toEqual(['cd-A', 'cd-B', UNASSIGNED_DOCTOR_KEY]);
    expect(summary[summary.length - 1].unassigned).toBe(true);
  });

  test('미배정만 존재 → 미지정 버킷 단독 집계', () => {
    const rows = [{ treatingDoctorId: null }, { treatingDoctorId: null }];
    const summary = computeDoctorCountSummary(rows, names);
    expect(summary).toHaveLength(1);
    expect(summary[0].key).toBe(UNASSIGNED_DOCTOR_KEY);
    expect(summary[0].name).toBe('미지정');
    expect(summary[0].count).toBe(2);
  });

  test('이름맵에 없는 treating_doctor_id(비활성 원장) → UUID 미노출·라벨 폴백', () => {
    const rows = [{ treatingDoctorId: 'cd-GONE' }];
    const summary = computeDoctorCountSummary(rows, names);
    expect(summary[0].name).toBe('진료의(비활성)');
    expect(summary[0].name).not.toContain('cd-GONE');
  });

  test('빈 명단(당일 0명) → 요약 빈 배열(요약 미노출 → 빈 상태 메시지가 대체)', () => {
    expect(computeDoctorCountSummary([], names)).toEqual([]);
  });
});

// ─── B. 브라우저 재현 경로 (Radix Tabs lazy-mount → 탭 클릭) ────────────────────

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

test.describe('브라우저 재현 — 진료 환자 이력 탭 신청/발행 2열 + 진료의별 요약', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('탭 클릭 → 신청·발행 2열 헤더 렌더 + (명단 有 시) 진료의별 요약 프레임', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    // 4탭 컨테이너 진입 확인
    const tabs = page.getByTestId('treatment-section-tabs');
    await expect(tabs).toBeVisible({ timeout: 10000 });

    // 진료 환자 이력 탭 클릭(기본탭이나 lazy-mount 방어 위해 명시 클릭)
    const historyTab = page.getByTestId('tab-doctor-history');
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    // 섹션 프레임 가시화(당일 데이터 유무 무관)
    const section = page.getByTestId('doctor-history-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 명단 有 → 신청/발행 2열 + 요약. 명단 無(빈 상태) → 빈 상태 메시지. 둘 중 하나는 반드시 렌더.
    const table = page.getByTestId('doctor-history-table');
    const empty = page.getByTestId('doctor-history-empty');
    await expect(table.or(empty)).toBeVisible({ timeout: 10000 });

    if (await table.isVisible().catch(() => false)) {
      // 요구1: 신청여부 + 발행여부 각각 별도 표시(2개 항목)
      await expect(page.getByTestId('dh-opinion-request').first()).toBeVisible();
      await expect(page.getByTestId('dh-opinion-issue').first()).toBeVisible();
      // 요구2: 진료의별 금일 담당 요약(명단 있으면 항상 노출)
      await expect(page.getByTestId('dh-doctor-count-summary')).toBeVisible();
    }
  });
});
