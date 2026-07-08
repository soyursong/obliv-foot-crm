/**
 * T-20260708-foot-TIMETABLE-CUSTBOX-WIDEN-MEMOLINE (P2)
 * 대시보드 통합시간표 고객박스 레이아웃 3항 (FE 렌더 only, db_change=false) — 김주연 총괄(MSG-x48o).
 *
 * 요청:
 *   (1) 성함 '절대 잘림 금지' → 통합시간표 가로 칸 너비 확대(접기 기능 있음). 말줄임(…)/tooltip 불가 = 전체표시.
 *   (2) 선택칩 간략메모([발톱무좀]/[내성발톱]/[발각질케어]/[힐러] 등) 노출 유지(현행).
 *   (3) 선택칩 4종을 제외한 '수기 메모'를 고객박스 성함 바로 아래 1줄로 표시.
 *
 * 수기메모 소스 확정 (AC3-2 "코드에서 실소스 먼저 확정"):
 *   check_ins.doctor_call_memo 는 CheckIn 전용(예약박스 미보유·진료콜 명단 전용, 칩과 무관)이라 리포터가 열거한
 *   '칩 4종 제외'와 맞지 않는다. brief_note 는 칩 선택 시 칩 라벨, 자유입력 시 수기텍스트가 담기는 단일 필드
 *   (ReservationDetailPopup 직접입력). 따라서 '칩 4종 제외한 수기 메모' = isBriefNoteChip=false 인 자유텍스트 brief_note.
 *   → 소스 = free-text brief_note (초진 예약 박스 box1, 칩을 노출하는 그 박스).
 *
 * 수정 (presentation only / DB·RPC·스키마 무변경 — src/pages/Dashboard.tsx):
 *   - 성함 span(활성 3사이트) whitespace-normal break-words 로 전체표시(truncate/tooltip 폐기). 패널 w-80→w-96.
 *   - box1(초진 예약 박스) flex-col: 1행=성함 식별자 줄(칩 유지), 2행=자유텍스트 brief_note(성함 아래 1줄, 없으면 미렌더).
 *
 * S1 (AC1): 성함 전체표시(whitespace:normal, 가로 clip 없음) — 말줄임 잔재 없음.
 * S2 (AC1 정적): 통합시간표 패널 펼침폭 w-96(w-80 아님).
 * S3 (AC2 정적): 간략메모 칩(box1-brief-note) 렌더 유지 — 소스 규칙(isBriefNoteChip) 무접촉.
 * S4 (AC3 정적): box1 수기메모 줄(box1-free-memo)이 free-text brief_note(!isBriefNoteChip) 게이트로만 렌더, 없으면 미렌더.
 * S5 (AC3/AC4 런타임): box1-free-memo 가 존재하면 성함(timeline-name) '아래'에 위치하고 비어있지 않다(빈 줄 잔류 없음).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const DASHBOARD_SRC = readFileSync(
  join(process.cwd(), 'src/pages/Dashboard.tsx'),
  'utf-8',
);

const NAME_CELLS = [
  '[data-testid="box1-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="box2-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="timeline-checkin-card"] [data-testid="timeline-name"]',
].join(', ');

test.describe('T-20260708-foot-TIMETABLE-CUSTBOX-WIDEN-MEMOLINE', () => {
  // ── S1: 성함 전체표시 (AC1) ──
  test('S1: 통합시간표 성함이 전체표시(whitespace:normal, 가로 clip 없음, 말줄임 없음)된다(AC1)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const names = page.locator(NAME_CELLS);
    const count = await names.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const el = names.nth(i);
      const s = await el.evaluate((node) => {
        const cs = getComputedStyle(node as HTMLElement);
        return {
          whiteSpace: cs.whiteSpace,
          clipped: (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth + 1,
          shown: (node.textContent ?? '').trim(),
        };
      });
      expect(s.whiteSpace).toBe('normal');
      expect(s.clipped).toBe(false);
      expect(s.shown.endsWith('…')).toBe(false);
      expect(s.shown.length).toBeGreaterThan(0);
    }
  });

  // ── S2: 패널 펼침폭 확대 (AC1 정적) ──
  test('S2: 통합시간표 패널 펼침폭이 w-96 으로 확대되었다(w-80 아님)(AC1)', async () => {
    expect(DASHBOARD_SRC).toMatch(/timelineFolded \? 'w-8' : 'w-96'/);
    expect(DASHBOARD_SRC).not.toMatch(/timelineFolded \? 'w-8' : 'w-80'/);
  });

  // ── S3: 선택칩 간략메모 유지 (AC2 정적) ──
  test('S3: 선택칩 간략메모(box1-brief-note) 렌더가 유지되고 소스 규칙(isBriefNoteChip)이 무접촉이다(AC2)', async () => {
    expect(DASHBOARD_SRC).toContain('data-testid="box1-brief-note"');
    // 칩 게이트(선택칩만 표시) 유지 — BRIEFMEMO-CHIPONLY 소유 규칙 무변경
    expect(DASHBOARD_SRC).toMatch(/isBriefNoteChip\(reservation\.brief_note\) && \(/);
  });

  // ── S4: 수기메모 줄 — free-text brief_note 게이트로만 렌더 (AC3 정적) ──
  test('S4: box1 수기메모 줄(box1-free-memo)이 free-text brief_note(!isBriefNoteChip)로만 렌더된다(AC3-1/AC3-3)', async () => {
    // free-text 판정: brief_note 존재 && 칩 아님
    expect(DASHBOARD_SRC).toMatch(
      /const showBox1FreeMemo = !!box1FreeMemo && !isBriefNoteChip\(reservation\.brief_note\);/,
    );
    // 게이트 조건부 렌더(없으면 미렌더 → 빈 줄 잔류 없음, AC3-3)
    expect(DASHBOARD_SRC).toMatch(/\{showBox1FreeMemo && \(/);
    expect(DASHBOARD_SRC).toContain('data-testid="box1-free-memo"');
    // 소스는 doctor_call_memo(진료콜 전용·예약박스 미보유)가 아님을 명시(오소스 회귀 가드)
    expect(DASHBOARD_SRC).not.toContain('reservation.doctor_call_memo');
  });

  // ── S5: 수기메모 줄이 성함 아래에 위치 + 빈 줄 없음 (AC3/AC4 런타임) ──
  test('S5: box1-free-memo 는 성함(timeline-name) 아래에 위치하고 비어있지 않다(AC3-1/AC4)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const memos = page.locator('[data-testid="box1-resv-card"] [data-testid="box1-free-memo"]');
    const count = await memos.count();
    if (count === 0) {
      test.skip(true, '오늘 자유텍스트 수기메모 보유 초진 예약 없음 — 런타임 위치검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const memo = memos.nth(i);
      const txt = ((await memo.textContent()) ?? '').trim();
      expect(txt.length).toBeGreaterThan(0); // 빈 줄 잔류 없음
      // 같은 카드 내 성함보다 아래(수직 top 이 더 큼)
      const card = memo.locator('xpath=ancestor::*[@data-testid="box1-resv-card"][1]');
      const name = card.locator('[data-testid="timeline-name"]').first();
      const nameBox = await name.boundingBox();
      const memoBox = await memo.boundingBox();
      if (nameBox && memoBox) {
        expect(memoBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 2);
      }
    }
  });
});
