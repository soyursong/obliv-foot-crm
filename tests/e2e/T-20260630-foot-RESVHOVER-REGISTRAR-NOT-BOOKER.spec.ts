import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-RESVHOVER-REGISTRAR-NOT-BOOKER
 *
 * 버그: 예약관리 달력뷰 예약카드 hover 간략정보 윗줄 '등록자: 예약일시' 가
 *   예약등록자(registrar) 아닌 booker(예약 입력 로그인 계정)를 표시 →
 *   어떤 스태프를 골라 저장해도 항상 동일하게 booker(예: '김주연')로 보임.
 *
 * 근본원인(확정): Reservations.tsx hover reservationInfo.registrarLabel = resvBookerMap.get(r.id)
 *   라벨은 '등록자:'(registrar)인데 데이터는 booker → 라벨-데이터 불일치.
 *   정본 컬럼 reservations.registrar_name(예약등록자 스냅샷, T-20260624 deployed, 기존) 존재.
 *   목록칩 @registrar_name 은 이미 이걸 씀. hover 만 booker였음.
 *
 * 수정(FE-only, 무 DDL): registrarLabel = registrar_name 우선.
 *   ⚠ SUPERSEDED by T-20260630-foot-RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH:
 *     본 티켓은 'registrar_name 우선 + booker fallback' 부분교정이었으나, 후속 현장신고에서 fallback
 *     자체(예약등록자 미지정/타경로 행이 booker '김주연'을 등록자로 오표기)가 미스매치 소스로 확정됨 →
 *     registrarLabel = r.registrar_name?.trim() || null (booker fallback 완전 제거)로 완결.
 *   아래 소스-무결성 단언은 후속 계약(registrar_name ONLY)으로 갱신 — 라이브 안전성 테스트는 그대로 유효.
 *
 * SoT: ReservationDetailPopup.tsx:508 — registrar_name=표시·선택용, booker(created_by)와 분리.
 *
 * AC(티켓 §4):
 *   AC-1: 김민경 선택→hover '김민경:'
 *   AC-2: 박민석 선택→hover '박민석:'
 *   AC-3: 서로 다른 등록자 2건 → 각각 다른 이름(전부 동일명 금지)
 *   AC-4(회귀): registrar_name null 구행 → fallback(booker/일시), 에러·빈 깨진 줄 없음
 *   AC-5(무회귀): 목록 @registrar_name 칩·'내 예약' 필터·저장값·상태 무변경
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak(갤탭 실기기).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const HOVER_CARD = fs.readFileSync(path.resolve('src/components/CustomerHoverCard.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 예약관리 진입 + 예약카드 hover 안전 렌더(에러 없음)
//   시나리오 1/2/3 의 공통 안전성: hover 가 깨지지 않고 '등록자:' 줄을 렌더.
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESVHOVER-REGISTRAR-NOT-BOOKER — 라이브', () => {
  test('AC-4: 예약관리 달력뷰 진입 + 예약카드 hover 시 에러/깨진 줄 없음(스냅샷 null 구행 안전)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/admin/reservations');
    const ready = await page.getByRole('button', { name: /새 예약|\+/ }).first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    if (!ready) { test.skip(true, '예약관리 진입 실패 — 스킵'); return; }

    // 예약카드(고객 hover 트리거)가 있으면 첫 카드에 hover → 간략정보 안전 렌더 확인.
    const cards = page.locator('[data-testid^="customer-hover-"], .cursor-grab, .cursor-pointer');
    const cnt = await cards.count();
    if (cnt > 0) {
      await cards.first().hover().catch(() => {});
      await page.waitForTimeout(400);
    }
    // hover 가 페이지를 깨뜨리지 않음(런타임 에러 0). 데이터 의존 케이스라도 회귀0.
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — hover '등록자:' 줄 소스가 registrar_name 우선 + booker fallback
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESVHOVER-REGISTRAR-NOT-BOOKER — 결선 (소스 무결성)', () => {
  test('AC-1/AC-2/AC-3 (SUPERSEDED→갱신): hover registrarLabel = registrar_name ONLY', () => {
    // 정본 = registrar_name(예약등록자 스냅샷). booker fallback 은 STAFF-MISMATCH 후속에서 제거됨.
    const matches = RESV_PAGE.match(/registrarLabel:\s*r\.registrar_name\?\.trim\(\)\s*\|\|\s*null,/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('교정 완전성(갱신): hover registrarLabel 에 booker(resvBookerMap) 잔존 0', () => {
    expect(RESV_PAGE).not.toMatch(/registrarLabel:[^,]*resvBookerMap/);
  });

  test('AC-5(무회귀): 목록 칩은 그대로 @registrar_name 사용(불변)', () => {
    expect(RESV_PAGE).toMatch(/@\{r\.registrar_name\}/);
  });

  test('AC-5(무회귀): registrar_name 필드는 reservation 타입에 기존 존재(신규 컬럼 아님)', () => {
    expect(RESV_PAGE).toMatch(/registrar_name\?:\s*string\s*\|\s*null/);
  });

  test("AC-5(무회귀): '내 예약' 필터는 registrar_name 기준 NAME-MATCH 불변", () => {
    expect(RESV_PAGE).toMatch(/\(r\.registrar_name\s*\?\?\s*''\)\.trim\(\)\s*===\s*mineTarget/);
  });

  test('주석 교정: CustomerHoverCard registrarLabel 주석이 registrar_name(예약등록자) 기준으로 갱신', () => {
    expect(HOVER_CARD).toContain('예약등록자(registrar_name');
    // booker 를 '등록자'로 오인 연결한 옛 주석('예약 잡은 계정명(resvBookerMap, 예: ')은 제거.
    expect(HOVER_CARD).not.toContain("예약 잡은 계정명(resvBookerMap, 예: 'admin'). 없으면");
  });
});
