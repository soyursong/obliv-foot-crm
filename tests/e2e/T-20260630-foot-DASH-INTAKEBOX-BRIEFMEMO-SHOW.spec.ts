/**
 * T-20260630-foot-DASH-INTAKEBOX-BRIEFMEMO-SHOW
 * 대시보드 통합 시간표 '초진' 예약 고객박스 — '성함 폰뒷자리' → '성함 폰뒷자리 [간략메모]'
 *
 * 배경 (김주연 총괄):
 *   초진 예약 박스(DraggableBox1Card)는 '성함 폰뒷4자리'만 표기했다. 신규예약 통합 모달
 *   (T-20260629-foot-NEWRESV-UNIFIED-MODAL)에서 선택한 간략메모(brief_note: 발톱무좀/내성발톱/
 *   발각질케어 또는 직접입력)를 박스에 함께 노출해 현장 식별을 돕는다. 예) `김사월 6282 [발톱무좀]`.
 *
 * 변경 (presentation only / DB·RPC·스키마 무변경 — src/pages/Dashboard.tsx):
 *   - DraggableBox1Card: 폰 뒷4자리 span 뒤에 brief_note 가 있으면 `[brief_note]` span 추가.
 *     · 영속 reservations.brief_note(TEXT, 既존 컬럼 migration 20260624100000) read·render only.
 *       신규 컬럼/enum/테이블/CONSULT 0 (ADDITIVE 저장 불필요 — 既저장 필드 재사용).
 *     · 간략메모 미선택(빈값) → span 미렌더 ('미선택/재진은 기존 그대로' 보장).
 *     · [힐러]는 brief_note 텍스트가 아니라 is_healer_intent(영속 플래그)+노란박스(#FFFDE7) →
 *       이 span 에 자동 비표기 (AC-4 노란박스 중복 회피).
 *     · AC-2 clip 가드: max-w-[80px]+truncate (폭 넘침 방지, 성함은 truncate 우선 공간 확보).
 *
 * 현장 클릭 시나리오 → E2E:
 *   S1 (AC-1): 초진 예약 박스에 brief_note span 이 있으면 `[...]` 형태(브래킷·비공백)다.
 *   S2 (AC-5 회귀): 초진 예약 박스는 여전히 '초' 배지 + 성함 + 폰 뒷4자리(\d{4})를 표기한다.
 *   S3 (정적 가드, 데이터 무관): Dashboard.tsx 소스에 brief_note 조건부 렌더 + testid 가 존재한다.
 *   S4 (정적 가드, AC-4 직교): brief-note span 은 brief_note 텍스트만 사용 — is_healer_intent/노란박스 토큰 비참조.
 *   S5 (정적 가드, 비파괴): brief_note 외 신규 컬럼 참조 없음 + 재진 카드 미변경.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const BOX1_CARD = '[data-testid="box1-resv-card"]';
const BRIEF_NOTE = '[data-testid="box1-brief-note"]';

const DASHBOARD_SRC = readFileSync(
  join(process.cwd(), 'src/pages/Dashboard.tsx'),
  'utf-8',
);

test.describe('T-20260630-foot-DASH-INTAKEBOX-BRIEFMEMO-SHOW', () => {
  // ── S1: 초진 예약 박스 간략메모 span = `[...]` 브래킷 형태 (AC-1) ──
  test('S1: 초진 예약 박스 간략메모는 [...] 브래킷·비공백으로 표기된다(AC-1)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const memos = page.locator(`${BOX1_CARD} ${BRIEF_NOTE}`);
    const count = await memos.count();
    if (count === 0) {
      test.skip(true, '오늘 간략메모 선택된 초진 예약 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const txt = ((await memos.nth(i).textContent()) ?? '').trim();
      // `[발톱무좀]` 형태 — 대괄호로 감싸고 내부가 비공백
      expect(txt).toMatch(/^\[.+\]$/);
    }
  });

  // ── S2: 초진 예약 박스 기존 식별자(초 배지·성함·폰뒷4) 유지 (AC-5 회귀) ──
  test('S2: 초진 예약 박스는 초 배지 + 성함 + 폰 뒷4자리를 그대로 표기한다(AC-5 회귀)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const cards = page.locator(BOX1_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 초진 미내원 예약 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i);
      const txt = ((await card.textContent()) ?? '').trim();
      // '초' 배지 텍스트 존재
      expect(txt).toContain('초');
      // 폰 뒷4자리(\d{4}) 또는 결측 표기(????) 존재 — 기존 포맷 유지
      expect(txt).toMatch(/(\d{4}|\?{4})/);
    }
  });

  // ── S3: 정적 가드 — brief_note 조건부 렌더 + testid 존재 (데이터 무관 결정적) ──
  test('S3: Dashboard.tsx 소스에 brief_note 조건부 렌더 + testid 가 존재한다', async () => {
    // 既존 영속 컬럼 reservation.brief_note 를 조건부(미선택 미렌더)로 렌더
    expect(DASHBOARD_SRC).toContain('reservation.brief_note?.trim()');
    expect(DASHBOARD_SRC).toContain('data-testid="box1-brief-note"');
    // 브래킷 래핑 렌더
    expect(DASHBOARD_SRC).toMatch(/\[\{reservation\.brief_note\.trim\(\)\}\]/);
  });

  // ── S4: 정적 가드 — brief-note span 은 brief_note 텍스트만 사용 (AC-4 힐러 직교) ──
  test('S4: 간략메모 span 렌더는 is_healer_intent/노란박스 토큰을 참조하지 않는다(AC-4 직교)', async () => {
    // 실제 렌더 표현식(주석 제외)만 추출 — 조건부 시작 `{reservation.brief_note?.trim() && (` 부터
    // 닫는 `)}` 까지. 이 JSX 블록이 brief_note 텍스트만 쓰고 힐러 플래그/노란박스 토큰을 안 쓰는지 확인.
    const start = DASHBOARD_SRC.indexOf('{reservation.brief_note?.trim() && (');
    expect(start).toBeGreaterThan(-1);
    const block = DASHBOARD_SRC.slice(start, start + 360);
    expect(block).toContain('data-testid="box1-brief-note"');
    expect(block).not.toContain('is_healer_intent');
    expect(block).not.toContain('FFFDE7');
    expect(block).not.toContain('healer-');
  });

  // ── S5: 정적 가드 — 비파괴(신규 컬럼 0) + 재진 박스 미변경 ──
  test('S5: brief_note 외 신규 예약 컬럼 참조 없음 + 재진 카드(Box2) 미변경', async () => {
    // 본 변경에서 도입한 식별자는 brief_note(既존) 뿐 — brief_note2/brief_memo 등 신규 컬럼명 없음
    expect(DASHBOARD_SRC).not.toContain('brief_memo');
    expect(DASHBOARD_SRC).not.toContain('brief_note2');
    // 재진 예약 카드(DraggableBox2ResvCard)에는 box1-brief-note testid 가 누출되지 않음
    const box2Start = DASHBOARD_SRC.indexOf('function DraggableBox2ResvCard');
    expect(box2Start).toBeGreaterThan(-1);
    const box2End = DASHBOARD_SRC.indexOf('function ', box2Start + 10);
    const box2Block = DASHBOARD_SRC.slice(box2Start, box2End > -1 ? box2End : undefined);
    expect(box2Block).not.toContain('box1-brief-note');
  });
});
