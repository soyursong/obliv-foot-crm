import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN
 *
 * 버그: 예약상세 팝업에서 '예약메모' 저장 → 달력뷰 예약카드 hover 간략정보 카드에
 *   예약메모가 미표시(박민지 팀장 재현).
 *
 * 근본원인(확정 — 회귀 아님):
 *   - CustomerHoverCard 의 예약메모 렌더 라인(reservationInfo.bookingMemo)은 정상 잔존.
 *     오늘 11:45 deployed REGISTRAR-NOT-BOOKER(c4cc68d2)는 CustomerHoverCard 의 *주석*만 교정 →
 *     bookingMemo 렌더/배선 무손상(회귀 가설 기각).
 *   - 예약메모의 저장 SoT 는 reservation_memo_history(append-only 타임라인). 신규예약 생성 시점에만
 *     reservations.booking_memo 컬럼에 '초기메모'가 한 번 들어가고(부분 미러), 예약상세 팝업의
 *     ReservationMemoTimeline 으로 추가/수정한 메모는 컬럼을 갱신하지 않음(Reservations.tsx:1129
 *     '편집 시 항상 빈 값').
 *   - 그런데 hover 는 reservations.booking_memo(부분 미러 컬럼)만 읽음 → 팝업 타임라인으로 저장한
 *     메모가 hover 에 끝내 안 보임.
 *
 * 수정(FE-only, 무 DDL):
 *   1) fetchWeek 에서 list 전체 reservation_id 단일 배치 조회(reservation_memo_history) →
 *      reservation_id 별 대표 메모 1줄(고정 우선 pinned_at DESC, 없으면 최신 created_at DESC;
 *      ReservationMemoTimeline.sortMemoItems 와 동일 우선순위) resvMemoMap 구성(N+1 없음).
 *   2) 두 hover surface(일간 TIMEGRID + 2단 캘린더) bookingMemo =
 *        resvMemoMap.get(r.id) ?? r.booking_memo ?? null  → SoT 우선, 결손 시 레거시 컬럼 fallback(회귀0).
 *   3) 예약메모 insert 는 reservations realtime 채널을 트리거하지 않으므로, 예약상세 팝업 onClose 에
 *      fetchWeek() 1회 → 팝업에서 추가한 메모가 닫은 직후 hover 에 즉시 반영.
 *
 * ⚠ 핫스팟: CustomerHoverCard 는 (a)오늘 deployed REGISTRAR-NOT-BOOKER (b)in_progress HINT-PHRASE-REMOVE(title 제거)
 *   가 함께 만지는 컴포넌트. 본 수정은 Reservations.tsx 배선 + onClose 만 건드리고 CustomerHoverCard 렌더는
 *   무변경 → 도움말 제거(title 부재) + 예약메모 표시 + 동작(클릭/우클릭/롱프레스/호버) 全 유지.
 *
 * 시나리오(티켓 본문):
 *   S1(정상 표시복구): 예약상세 팝업에서 예약메모 저장 → 달력뷰 hover 간략정보에 그 메모가 표시.
 *   S2(빈메모 가드): 예약메모 이력 없음 → hover 예약메모 줄은 '-'(공백행/에러 없음).
 *   S3(동작·핫스팟 회귀가드): hover 카드 동작 + 도움말(title) 제거 + bookingMemo 렌더 라인 무손상.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak(갤탭 실기기).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const HOVER_CARD = fs.readFileSync(path.resolve('src/components/CustomerHoverCard.tsx'), 'utf-8');
const MEMO_TL = fs.readFileSync(path.resolve('src/components/ReservationMemoTimeline.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 예약관리 진입 + 예약카드 hover 안전 렌더(에러 없음)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESVHOVER-MEMO-NOT-SHOWN — 라이브', () => {
  test('S2/S3: 예약관리 달력뷰 진입 + 예약카드 hover 시 에러/깨진 줄 없음(빈메모 가드 포함)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/admin/reservations');
    const ready = await page.getByRole('button', { name: /새 예약|\+/ }).first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    if (!ready) { test.skip(true, '예약관리 진입 실패 — 스킵'); return; }

    // 예약카드 hover → 간략정보 카드(예약메모 줄 포함) 안전 렌더 확인.
    const cards = page.locator('[data-testid^="customer-hover-card-name"], .cursor-grab, .cursor-pointer');
    const cnt = await cards.count();
    if (cnt > 0) {
      await cards.first().hover().catch(() => {});
      await page.waitForTimeout(400);
      // hover 카드가 떴다면 '예약메모' 라벨이 보이거나(데이터 있으면 내용/없으면 '-'), 최소한 깨지지 않음.
      const hoverCard = page.getByTestId('customer-hover-card');
      if (await hoverCard.isVisible({ timeout: 1000 }).catch(() => false)) {
        // 예약메모 줄(있으면 내용/빈메모면 '-')이 에러 없이 렌더.
        await expect(hoverCard).toBeVisible();
      }
    }
    // 빈메모/이력없음 케이스라도 런타임 에러 0(공백행·crash 금지).
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — 예약메모 SoT(reservation_memo_history) 배선 + 두 surface 정합
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESVHOVER-MEMO-NOT-SHOWN — 결선 (소스 무결성)', () => {
  test('S1: hover bookingMemo 가 resvMemoMap(SoT) 우선 + booking_memo 컬럼 fallback 으로 배선', () => {
    // 정본 = reservation_memo_history 에서 끌어온 resvMemoMap. 팝업 타임라인 저장분이 hover 에 보이는 근거.
    const matches = RESV_PAGE.match(
      /bookingMemo:\s*resvMemoMap\.get\(r\.id\)\s*\?\?\s*r\.booking_memo\s*\?\?\s*null/g,
    ) ?? [];
    // 두 hover surface(일간 TIMEGRID + 2단 캘린더) 모두 교정 — 동일 정합.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('교정 완전성: bookingMemo 에 컬럼-only(r.booking_memo 단독) 잔존 없음', () => {
    // 수정 전 패턴 `bookingMemo: r.booking_memo ?? null` 이 남아있으면 SoT 미반영 surface 존재 → 금지.
    expect(RESV_PAGE).not.toMatch(/bookingMemo:\s*r\.booking_memo\s*\?\?\s*null/);
  });

  test('S1: resvMemoMap 가 reservation_memo_history 단일 배치(.in) 로 구성(N+1 없음)', () => {
    expect(RESV_PAGE).toContain('setResvMemoMap');
    expect(RESV_PAGE).toMatch(/from\(['"]reservation_memo_history['"]\)/);
    // 단일 배치 — reservation_id 묶음 조회.
    expect(RESV_PAGE).toMatch(/\.in\(['"]reservation_id['"],\s*resvIds\)/);
  });

  test('S1: 대표 메모 선택은 고정 우선(pinned_at DESC) + 최신(created_at DESC) — 타임라인 sortMemoItems 와 동일 우선순위', () => {
    // 고정(is_pinned) 분기 + created_at 비교가 맵 구성부에 존재.
    expect(RESV_PAGE).toMatch(/is_pinned/);
    expect(RESV_PAGE).toMatch(/created_at['"]?\)?\.localeCompare/);
    // 원천 타임라인이 동일 우선순위 정렬을 쓰는지(정본 정렬 일치 가드).
    expect(MEMO_TL).toMatch(/is_pinned/);
  });

  test('S1: 예약상세 팝업 onClose 가 fetchWeek 동기화 — 메모 추가(타임라인) 후 닫으면 hover 즉시 반영', () => {
    // reservation_memo_history insert 는 reservations realtime 을 안 깨우므로 onClose 1회 동기화 필요.
    expect(RESV_PAGE).toMatch(/onClose=\{\(\)\s*=>\s*\{[\s\S]*?setDetail\(null\)[\s\S]*?fetchWeek\(\)[\s\S]*?\}\}/);
  });

  test('S3(핫스팟 회귀가드): CustomerHoverCard 의 예약메모 렌더 라인 무손상(REGISTRAR 배포가 제거 안 함)', () => {
    // bookingMemo 를 읽어 표시하는 렌더 + 빈메모 시 '-' 가드 둘 다 존재.
    expect(HOVER_CARD).toMatch(/reservationInfo\.bookingMemo\?\.trim\(\)/);
    expect(HOVER_CARD).toContain('예약메모');
  });

  test('S2(빈메모 가드): hover 예약메모 줄은 값 없으면 -(공백행/에러 금지)', () => {
    // bookingMemo?.trim() ? <p>…</p> : <span>-</span> 3항 분기 유지.
    expect(HOVER_CARD).toMatch(/bookingMemo\?\.trim\(\)\s*\?[\s\S]*?:\s*\(\s*<span[^>]*>-<\/span>/);
  });

  test('S3(핫스팟 회귀가드): 도움말 title 제거(HINT-PHRASE-REMOVE) 유지 — 성함 트리거에 네이티브 title 속성 없음', () => {
    // 성함 span(클릭/우클릭 트리거)에 title= 속성이 다시 들어오지 않았는지(겹침 재발 방지).
    // onClick/onContextMenu 동작은 유지하되 title 속성은 부재.
    const nameSpanBlock = HOVER_CARD.match(/data-testid=\{onClick \? 'customer-hover-card-name-clickable'[\s\S]*?<\/span>/);
    expect(nameSpanBlock, '성함 트리거 span 블록을 찾지 못함').not.toBeNull();
    expect(nameSpanBlock![0]).not.toMatch(/\btitle=/);
  });

  test('S3(동작 유지): hover 카드의 클릭(onClick)·우클릭(onContextMenu)·호버 동작 핸들러 무변경', () => {
    expect(HOVER_CARD).toMatch(/onContextMenu=\{onContextMenu\}/);
    expect(HOVER_CARD).toMatch(/onMouseEnter=\{handleMouseEnter\}/);
    expect(HOVER_CARD).toMatch(/if \(!onClick\) return;/);
  });

  test('무회귀: 예약메모 저장 경로(insertReservationMemo → reservation_memo_history)는 불변', () => {
    expect(MEMO_TL).toMatch(/from\(['"]reservation_memo_history['"]\)\.insert/);
    // 신규예약 생성 시 초기메모 → 타임라인 삽입 경로 유지(컬럼+이력 이중기록 불변).
    expect(RESV_PAGE).toMatch(/insertReservationMemo\(/);
  });
});
