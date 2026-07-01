/**
 * E2E spec — T-20260701-foot-STAFFCAL-SIDEBAR-BROWN-MONO
 *
 * 사이드바 근무캘린더(직원 달력) 컴포넌트 CalendarNoticePanel 의 브라운(갈색) 계열
 * 장식 톤 → 무채색(그레이/화이트/블랙) 모노톤 치환.
 *
 * ── 배경(REDEFINITION_RISK / carve-out 계승):
 *   · tailwind.config.js 는 부모 THEME-MONOCHROME-RECOLOR 로 teal-* 램프를 warm-monochrome
 *     (Classic Taupe/Umber = 브라운) 으로 스윕한다. 따라서 CalendarNoticePanel 에서 쓰던
 *     장식용 teal-*(text-teal-600·bg-teal-50·text-teal-800 등)는 실제로 브라운/베이지로 렌더된다.
 *   · 본 티켓은 그 장식 브라운만 무채색 gray-*(치환 불가 팔레트=미스윕 중립 그레이)로 교체.
 *   · 직전 T-20260629-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE(1447036a)의 컴팩트/파스텔 정비
 *     결과(레이아웃·duty-roster-section 보존)는 되돌리지 않는다.
 *
 * ── AC:
 *   AC1: 사이드바 근무캘린더 컴포넌트에서 브라운 소스(teal / amber / stone / brown / beige) 장식 톤 0건.
 *   AC2: 의미색·기능·데이터 무변경 — 주말 요일색(red/blue)·인수인계 완료(emerald)·삭제(red-600) 보존.
 *   AC3: 무채색 gray-* 로 유리 실버/모노 UI 와 시각 통일.
 *   AC4: DB/DDL 무변경(순수 FE, 소스 diff 로 보증).
 *
 * 검증 방식: 소스 정적 스캔(색 토큰 치환은 순수 className 변경이라 소스가 SSOT) + 실브라우저 렌더 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL = resolve(__dirname, '../../src/components/CalendarNoticePanel.tsx');
const src = readFileSync(PANEL, 'utf8');

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260701-foot-STAFFCAL-SIDEBAR-BROWN-MONO — 사이드바 근무캘린더 브라운→무채색', () => {
  // ── AC1: 브라운 소스 팔레트 0건 ──────────────────────────────────────────────
  test('AC1: 장식 브라운 소스(teal / amber / stone / brown / beige) 0건', () => {
    // teal-* 는 config 에서 브라운(Taupe/Umber) 램프로 스윕되므로 장식용 잔존 금지.
    expect(src).not.toMatch(/\bteal-\d/);
    expect(src).not.toMatch(/\bamber-\d/);
    expect(src).not.toMatch(/\bstone-\d/);
    expect(src).not.toMatch(/\bbrown-\d/);
    expect(src).not.toMatch(/beige/i);
  });

  // ── AC3: 무채색 gray-* 로 치환되어 시각 통일 ─────────────────────────────────
  test('AC3: 무채색 gray-* 치환 존재(모노 통일)', () => {
    expect(src).toMatch(/\bgray-\d/);
    // 이전 teal 아이콘/칩 자리에 gray 계열이 실제로 들어갔는지 대표 토큰 확인.
    expect(src).toMatch(/text-gray-500/); // 아이콘
    expect(src).toMatch(/text-gray-700/); // 근무 명단 칩 텍스트/폼 헤딩
    expect(src).toMatch(/bg-gray-100/);   // 칩/하이라이트 bg
  });

  // ── AC2: 의미색 보존 ─────────────────────────────────────────────────────────
  test('AC2: 의미색(주말 red/blue·완료 emerald·삭제 red-600) 미치환 보존', () => {
    expect(src).toMatch(/text-red-500/);    // 일요일
    expect(src).toMatch(/text-blue-500/);   // 토요일
    expect(src).toMatch(/text-emerald-600/); // 인수인계 체크 완료
    expect(src).toMatch(/hover:text-red-600/); // 공지 삭제(destructive)
  });

  // ── AC4 회귀: duty-roster-section 보존(직전 파스텔/컴팩트 정비 결과 미회귀) ────
  test('AC4: duty-roster-section/handover 구조 보존(직전 정비 미회귀)', () => {
    expect(src).toContain('data-testid="duty-roster-section"');
    expect(src).toContain('data-testid="duty-roster-handover"');
  });

  // ── 실브라우저 렌더 가드: 사이드바 패널이 정상 렌더된다(데이터 graceful) ──────
  test('렌더 가드: 대시보드에서 사이드바 근무캘린더 섹션 렌더', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('duty-roster-section')).toHaveCount(1);
  });
});
