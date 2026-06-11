import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-PROGRESS-VIEW-BATCH-CHECKIN-LEAK
 *   (정본: T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK §2b 흡수)
 * 원천: 김주연 총괄(C0ATE5P6JTH).
 *
 * 버그: 경과분석 캘린더(filterProgress ON)에서 '일괄 배치(체크인)' 버튼이
 *       filterProgress와 무관하게 전체 confirmed 예약을 batchCheckIn 처리 →
 *       경과분석 불필요 환자까지 일괄 체크인되는 누수. 경과분석 뷰=조회 전용.
 *
 * 수정(권장안=버튼 숨김):
 *   AC-1: filterProgress === true 일 때 '일괄 배치' 버튼 렌더 안 함 (조건 !filterProgress 추가).
 *   AC-2: filterProgress OFF(일반 달력)에서는 기존대로 정상 표시·동작(회귀 없음).
 *   AC-3: batchCheckIn 호출 로직 자체 불변(버튼 렌더 가드만).
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating. 실 토글 렌더는 supervisor field-soak.
 * DB 무관(FE-only, 버튼 렌더 조건 단일 변경).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// '일괄 배치' 버튼 렌더 블록 추출 (confirmed 산출 IIFE ~ 버튼 ~ null)
function batchButtonBlock(): string {
  const m = RESV_PAGE.match(
    /const confirmed = list\.filter\(\(r\) => r\.status === 'confirmed'\);([\s\S]*?일괄 배치 \(\{confirmed\.length\}\)[\s\S]*?)\}\)\(\)\}/,
  );
  expect(m, "'일괄 배치' 버튼 렌더 블록 파싱 실패").toBeTruthy();
  return m![1];
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 경과분석 뷰(filterProgress ON)에서 '일괄 배치' 버튼 숨김
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1: filterProgress ON 시 일괄 배치 버튼 가드', () => {
  test('AC1-1: 일괄 배치 버튼 렌더 조건에 !filterProgress 가드가 있다', () => {
    const block = batchButtonBlock();
    // 렌더 삼항 조건 = `!filterProgress && confirmed.length > 0 ?`
    expect(block, '!filterProgress 가드 누락 — 경과분석 뷰에서 버튼 노출됨').toMatch(
      /!filterProgress\s*&&\s*confirmed\.length\s*>\s*0\s*\?/,
    );
  });

  test('AC1-2: 가드 없는 옛 조건(confirmed.length > 0 ? 단독)이 남아있지 않다', () => {
    const block = batchButtonBlock();
    // filterProgress 없이 confirmed.length > 0 ? 로 시작하는 옛 패턴 부재
    expect(block, '옛 무가드 조건(return confirmed.length > 0 ?) 잔존').not.toMatch(
      /return\s+confirmed\.length\s*>\s*0\s*\?/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — batchCheckIn 호출 로직 불변 (버튼 가드만 변경)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3: batchCheckIn 로직 불변', () => {
  test('AC3-1: batchCheckIn(confirmed) 호출이 그대로 유지된다', () => {
    const block = batchButtonBlock();
    expect(block, 'batchCheckIn(confirmed) 호출 변경/제거됨').toContain('batchCheckIn(confirmed)');
  });

  test('AC3-2: confirmed 산출은 여전히 status===confirmed 전체 (대상 축소 아님 — 일반 달력 동작 보존)', () => {
    // AC-3: 권장안은 "버튼 숨김"이지 confirmed 배열 축소(대안 미채택)가 아님.
    expect(RESV_PAGE, "confirmed 산출이 status==='confirmed' 단순 필터가 아님").toContain(
      "const confirmed = list.filter((r) => r.status === 'confirmed');",
    );
    // 대안(미채택) progress_check_required 로 batchCheckIn 대상 제한이 들어가지 않았는지 확인
    expect(RESV_PAGE, '미채택 대안(progress_check_required로 batchCheckIn 대상 축소) 혼입')
      .not.toMatch(/batchCheckIn\([^)]*progress_check_required/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// smoke — 예약관리 페이지 로드 회귀(AC-2 일반 달력 회귀 가드 보조)
// ═══════════════════════════════════════════════════════════════════════════
test('smoke: 예약관리 페이지 정상 로드(회귀 없음)', async ({ page }) => {
  const response = await page.goto(`${BASE_URL}/admin/reservations`);
  expect(response?.status()).toBeLessThan(400);
  const html = await page.content();
  expect(html.length).toBeGreaterThan(100);
});
