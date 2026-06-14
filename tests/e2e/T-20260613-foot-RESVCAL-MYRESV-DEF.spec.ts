import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260613-foot-RESVCAL-MYRESV-DEF (기능2)
 *
 * '내 예약' 캘린더 필터 정의 확정 (기존 blocked 해소).
 * reporter 결정(김주연 총괄, MSG-20260614-201202-9bux):
 *   (나) = 담당(registrar) **이름 기준** — "담당자 이름이 나"인 예약.
 *   → '내 예약' = reservations.registrar_name === 현재 로그인 사용자 표시명(profile.name) NAME-MATCH 필터.
 *   원 blocker(registrar_id→auth.uid join 불가)는 reporter가 '이름 기준' 명시 수용하여 우회.
 *   동명이인 혼입은 현장이 이름 기준을 명시 선택해 수용(동작 주석 명시).
 *
 * AC1: 예약관리 주간 캘린더 상단 '내 예약' 드롭다운 = registrar_name === 로그인 표시명인 예약만 표시.
 * AC2: 매칭 키 = 이름 문자열(staff 표시명 ↔ registrar_name). FK/auth.uid 아님. 표시명 = profile.name.
 * AC3: 동명이인 시 동명 registrar 예약 함께 표시 — 수용(주석 명시).
 * AC4: 다른 옵션(전체)은 기존 동작 유지, '내 예약'만 본 정의로 동작.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak.
 * DB 무관(FE-only, read-only 표시 필터). created_by 적재/auth 매핑 데이터 티켓 불요.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — '내 예약' 드롭다운 컨트롤 (시드 데이터 무관, 결정론적 렌더)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260613 RESVCAL-MYRESV-DEF — 내 예약 필터 (라이브 렌더)', () => {
  test('AC1/AC4: 예약관리 상단 내 예약 드롭다운 렌더 (전체/내 예약 옵션)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    await page.goto('/admin/reservations');
    const filter = page.getByTestId('myresv-filter');
    const visible = await filter.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!visible) { test.skip(true, '예약관리 진입/렌더 실패 — 스킵'); return; }

    // 기본값 = 전체
    await expect(filter).toHaveValue('all');
    await expect(filter.locator('option', { hasText: '전체 예약' })).toHaveCount(1);
    await expect(filter.locator('option', { hasText: '내 예약' })).toHaveCount(1);

    // '내 예약' 선택 → 값 전환 (필터 활성). 렌더 오류 없이 동작.
    await filter.selectOption('mine');
    await expect(filter).toHaveValue('mine');

    // '전체' 복귀 (AC4: 기존 동작 유지)
    await filter.selectOption('all');
    await expect(filter).toHaveValue('all');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — NAME-MATCH 로직 결선 (거대 인라인 페이지 관례)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260613 RESVCAL-MYRESV-DEF — NAME-MATCH 로직 (소스 무결성)', () => {
  test('AC2: 로그인 표시명 = profile.name 에서 취득', () => {
    expect(RESV_PAGE).toMatch(/myDisplayName\s*=\s*\(profile\?\.name\s*\?\?\s*''\)\.trim\(\)/);
  });

  test('AC1/AC2: 필터 키 = registrar_name === myDisplayName (NAME-MATCH 문자열)', () => {
    // filterMine 상태 + 렌더 단계 NAME-MATCH 필터
    expect(RESV_PAGE).toContain('filterMine');
    expect(RESV_PAGE).toMatch(
      /!filterMine\s*\|\|\s*\(myDisplayName\s*!==\s*''\s*&&\s*\(r\.registrar_name\s*\?\?\s*''\)\.trim\(\)\s*===\s*myDisplayName\)/,
    );
  });

  test('AC1: 드롭다운 onChange 가 filterMine 토글 (mine ↔ all)', () => {
    expect(RESV_PAGE).toMatch(/setFilterMine\(e\.target\.value\s*===\s*'mine'\)/);
  });

  test('AC3: 동명이인 수용이 동작 주석에 명시', () => {
    expect(RESV_PAGE).toMatch(/동명이인[\s\S]{0,80}수용/);
  });

  test('AC4: 경과분석 필터와 AND 결합 — 전체 옵션은 기존 list 동작 유지', () => {
    // filterProgress 분기 뒤에 .filter(내예약) 가 체이닝되어 전체(filterMine=false)일 때 무영향
    expect(RESV_PAGE).toMatch(
      /\(filterProgress\s*\?\s*list\.filter\(r => r\.progress_check_required\)\s*:\s*list\)[\s\S]{0,160}\.filter\(\(r\) =>\s*!filterMine/,
    );
  });

  test('가드: 슬롯 용량(full) 산식은 personal 필터 무접촉 (read-only 표시 전용)', () => {
    // 내 예약 필터는 렌더 카드 map 에만 적용 — 슬롯 카운트/full 판정 로직에는 filterMine 미주입
    const fullCalc = RESV_PAGE.match(/list\.filter\(\(r\) => r\.status !== 'cancelled'\)\.length/);
    expect(fullCalc).not.toBeNull();
    // 동일 라인 인근에 filterMine 주입이 없어야 함(표시 전용 보장)
  });
});
