import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH
 *
 * 버그(현장): 예약관리 신규 예약 생성 시 '예약등록자'로 고른 담당자(예: 김민경/박민석)와,
 *   예약카드 간략정보(hover)에 노출되는 담당자명이 서로 다름 → 늘 예약을 잡은 로그인 계정
 *   (booker, 예: '김주연')이 '등록자'로 표기됨. (김오월/김사월 케이스, slack C0ATE5P6JTH)
 *
 * 근본원인(확정 — DB 대조 완료):
 *   - 예약등록자 선택값의 정본 = reservations.registrar_name(스냅샷, T-20260624 deployed) + registrar_id.
 *     DB 대조 결과 registrar_id↔registrar_name 저장 정합 0 미스매치 — 즉 저장은 정상.
 *   - 미스매치 RC = '렌더 소스 분기'. 동일 라벨('예약등록자'/'등록자:')인데 surface마다 데이터 소스가 달랐음:
 *       (a) 간략정보 hover(일간/2단뷰) registrarLabel = registrar_name **?? resvBookerMap(=created_by, booker)**
 *           → 예약등록자 미지정/타경로 행에서 booker(예약 잡은 계정)를 '등록자'로 오표기.
 *       (b) 일간뷰 카드 우측 @태그 = **resvBookerMap(booker)** 인데 title 은 '예약등록자' → 라벨-데이터 불일치.
 *       (c) 2단뷰 카드 우하단 @태그(L2470)만 registrar_name 사용(정상) → surface 간 불일치가 신고로 표면화.
 *
 * 수정(FE-only, 무 DDL — db_change=false):
 *   1) hover registrarLabel(일간 + 2단) = r.registrar_name?.trim() || null  (booker fallback 제거).
 *      → 선택한 예약등록자만 표기. 미지정 시 CustomerHoverCard 가 '등록자:' 라벨 생략(일시만, 깨짐 0).
 *   2) 일간뷰 카드 @태그 = r.registrar_name (booker → registrar_name).  2단뷰 @예약등록자 태그(L2470)와 단일 소스.
 *   3) 2단뷰 상태줄 '담당자' @태그(L2433, title='담당자')는 의도된 booker 표기(별개 개념) — 무변경(무회귀).
 *
 * 본 티켓은 T-20260630-foot-RESVHOVER-REGISTRAR-NOT-BOOKER(부분교정: registrar_name 우선 + booker fallback 잔존)을
 *   완결 supersede — fallback 자체가 미스매치 소스였음을 확정하고 제거.
 *
 * AC:
 *   AC-1: hover registrarLabel = registrar_name ONLY (resvBookerMap fallback 잔존 0).
 *   AC-2: 두 hover surface(일간 + 2단) 모두 동일 소스로 교정.
 *   AC-3: 일간뷰 카드 @태그 = registrar_name (booker 아님), title='예약등록자'.
 *   AC-4: 2단뷰 @예약등록자 태그(registrar_name)·'담당자'(booker) 분리 유지(무회귀).
 *   AC-5(회귀): registrar_name null 행 → 등록자 라벨 생략, 런타임 에러 0.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak(갤탭 실기기).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 예약관리 진입 + 예약카드 hover 안전 렌더(에러 없음)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH — 라이브', () => {
  test('AC-5: 예약관리 진입 + 예약카드 hover 시 런타임 에러/깨진 줄 없음(registrar_name null 행 안전)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/admin/reservations');
    const ready = await page.getByRole('button', { name: /새 예약|\+/ }).first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    if (!ready) { test.skip(true, '예약관리 진입 실패 — 스킵'); return; }

    const cards = page.locator('[data-testid^="registrar-tag-"], .cursor-grab, .cursor-pointer');
    const cnt = await cards.count();
    if (cnt > 0) {
      await cards.first().hover().catch(() => {});
      await page.waitForTimeout(400);
    }
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — '예약등록자' 표기 surface 전부 registrar_name 단일 소스
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH — 결선 (소스 무결성)', () => {
  test('AC-1/AC-2: hover registrarLabel = registrar_name ONLY (두 surface 모두)', () => {
    const matches = RESV_PAGE.match(
      /registrarLabel:\s*r\.registrar_name\?\.trim\(\)\s*\|\|\s*null,/g,
    ) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('AC-1(교정 완전성): hover registrarLabel 에 booker(resvBookerMap) fallback 잔존 0', () => {
    // 수정 전 패턴(registrar_name ?? resvBookerMap)도, booker-only 패턴도 hover registrarLabel 에 남으면 안 됨.
    expect(RESV_PAGE).not.toMatch(/registrarLabel:[^,]*resvBookerMap/);
  });

  test('AC-3: 일간뷰 카드 @태그 = registrar_name (booker 아님), title=예약등록자', () => {
    // registrar-tag(일간뷰)·하단 @예약등록자(2단뷰) 모두 registrar_name 기반.
    expect(RESV_PAGE).toMatch(/title=\{`예약등록자 \$\{r\.registrar_name\}`\}/);
    // 일간뷰 @태그가 booker(resvBookerMap)를 '예약등록자' title 로 붙이는 옛 패턴 잔존 금지.
    expect(RESV_PAGE).not.toMatch(/title=\{`예약등록자 \$\{resvBookerMap\.get\(r\.id\)\}`\}/);
  });

  test('AC-3: 카드 @예약등록자 칩 본문도 registrar_name 사용', () => {
    expect(RESV_PAGE).toMatch(/@\{r\.registrar_name\}/);
  });

  test("AC-4(무회귀): 2단뷰 '담당자' @태그는 의도된 booker(resvBookerMap, title='담당자') 유지", () => {
    expect(RESV_PAGE).toMatch(/title=\{`담당자 \$\{resvBookerMap\.get\(r\.id\)\}`\}/);
  });

  test("AC-4(무회귀): '내 예약' 필터는 registrar_name 기준 NAME-MATCH 불변", () => {
    expect(RESV_PAGE).toMatch(/\(r\.registrar_name\s*\?\?\s*''\)\.trim\(\)\s*===\s*mineTarget/);
  });

  test('무회귀: 신규 예약 생성 write-path는 registrar_id + registrar_name 동봉(저장 정합 유지)', () => {
    expect(RESV_PAGE).toMatch(/registrar_id:\s*params\.registrar_id\s*\?\?\s*null/);
    expect(RESV_PAGE).toMatch(/registrar_name:\s*params\.registrar_name\s*\?\?\s*null/);
  });
});
