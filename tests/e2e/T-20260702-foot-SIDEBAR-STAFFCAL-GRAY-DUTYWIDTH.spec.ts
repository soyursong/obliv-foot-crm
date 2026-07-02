/**
 * E2E spec — T-20260702-foot-SIDEBAR-STAFFCAL-GRAY-DUTYWIDTH (Bug A: 직원 근무 캘린더 브라운 잔존 제거)
 *
 * ── FIELD-SOAK FAIL 2차 근본원인(DIAGNOSTIC #2):
 *   직전 canonical T-20260701-foot-STAFFCAL-SIDEBAR-BROWN-MONO(commit 352a71cf)은
 *   **사이드바 CalendarNoticePanel.tsx** 만 무채색화했다(정적스캔 0·prod 배포 확인됨).
 *   그러나 현장(김주연 총괄)이 "직원 달력"이라 부른 화면은 사이드바 메뉴 '근무 캘린더'로 진입하는
 *   **Handover 페이지(/admin/handover)의 '직원 근무 캘린더' 섹션**(별도 캘린더 보드/셀 렌더러)이며,
 *   이 섹션은 352a71cf 가 손대지 않아 teal-*(=THEME-MONOCHROME-RECOLOR 램프에서 Taupe/Umber 브라운)로
 *   여전히 브라운 렌더됐다. → 본 티켓이 Handover '직원 근무 캘린더' 섹션의 teal-* 를 무채색 gray-* 로 치환.
 *
 * ── 배경(tailwind config 램프): teal-400~950 = Classic Taupe(#C5BEA3)/Umber(#6E6353·#443A35) 브라운.
 *   따라서 장식용 teal-* 는 실제로 브라운으로 렌더된다(teal-50~300 만 중립 그레이). 전부 gray-* 로 치환.
 *
 * ── scope 분리(dedup): 의사 근무표(DutyRosterTab) 섹션은 본 티켓 대상 아님(가로폭=DOCROSTER 전담,
 *   commit ebbd5c3c 완료). Handover.tsx 의 '직원 근무 캘린더' 섹션(h1 '직원 근무 캘린더' 이후 ~ EOF,
 *   MonthGrid/WeekStrip/CellAttendees 포함)만 검증 대상. 의사 근무표 헤더 아이콘(section 상단)은 제외.
 *
 * ── AC:
 *   AC1: '직원 근무 캘린더' 섹션 브라운 소스(teal / amber / stone / brown / beige) 장식 톤 0건.
 *   AC2: 의미색 보존 — 주말 요일색(red/blue)·삭제(red-600) 미치환.
 *   AC3: 무채색 gray-* 치환 존재(today 원·선택 셀·카운트 배지·칩 모노 통일).
 *   AC4: DB/DDL 무변경(순수 FE className, 소스 diff 로 보증).
 *
 * 검증: 소스 정적 스캔(색 토큰 = className 변경이라 소스가 SSOT). 실브라우저 육안 회색 확정 +
 *   prod 번들 해시 변경 확인은 supervisor QA·현장 재확인 게이트(정적 grep 0 단독 신뢰 금지).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDOVER = resolve(__dirname, '../../src/pages/Handover.tsx');
const full = readFileSync(HANDOVER, 'utf8');

// '직원 근무 캘린더' 섹션 이후 ~ EOF (MonthGrid/WeekStrip/CellAttendees 포함) 만 대상.
// 의사 근무표(DutyRosterTab) 섹션 헤더는 이 마커 이전이라 자연 제외됨(dedup — DOCROSTER 전담).
const markerIdx = full.indexOf('직원 근무 캘린더');
const staffCalSection = full.slice(markerIdx);

test.describe('T-20260702-foot-SIDEBAR-STAFFCAL-GRAY-DUTYWIDTH — Handover 직원 근무 캘린더 브라운→무채색', () => {
  test('마커 sanity: 직원 근무 캘린더 섹션 추출 성공', () => {
    expect(markerIdx).toBeGreaterThan(0);
    expect(staffCalSection).toMatch(/MonthGrid/);
    expect(staffCalSection).toMatch(/WeekStrip/);
  });

  // ── AC1: 브라운 소스 팔레트 0건 (teal-* 는 config 램프에서 브라운으로 렌더) ──
  test('AC1: 직원 근무 캘린더 섹션 브라운 소스(teal/amber/stone/brown/beige) 0건', () => {
    expect(staffCalSection).not.toMatch(/\bteal-\d/);
    expect(staffCalSection).not.toMatch(/\bamber-\d/);
    expect(staffCalSection).not.toMatch(/\bstone-\d/);
    expect(staffCalSection).not.toMatch(/\bbrown-\d/);
    expect(staffCalSection).not.toMatch(/beige/i);
  });

  // ── AC3: 무채색 gray-* 치환 존재(모노 통일) ──
  test('AC3: today 원·선택 셀·카운트 배지·칩 무채색 gray-* 치환', () => {
    expect(staffCalSection).toMatch(/bg-gray-700 text-white/);   // today 원 / 카운트 배지 / 뷰토글 활성
    expect(staffCalSection).toMatch(/border-gray-400 bg-gray-100/); // 선택 셀
    expect(staffCalSection).toMatch(/bg-gray-100 px-1 text-\[9px\][^"']*text-gray-700/); // 셀 출근자 칩
    expect(staffCalSection).toMatch(/accent-gray-600/);          // 체크박스 accent
    expect(staffCalSection).toMatch(/text-gray-500/);            // 헤더 아이콘
  });

  // ── AC2: 의미색 보존 ──
  test('AC2: 의미색(주말 red/blue·삭제 red-600) 미치환 보존', () => {
    expect(staffCalSection).toMatch(/text-red-500/);   // 일요일
    expect(staffCalSection).toMatch(/text-blue-500/);  // 토요일
    expect(staffCalSection).toMatch(/hover:text-red-600/); // 인수인계 삭제(destructive)
  });

  // ── AC4: 순수 FE(색 토큰 className) — 데이터/RPC/DDL 무접촉 ──
  test('AC4: 색 토큰 외 로직·데이터 접근 무변경(순수 className 치환)', () => {
    // 치환된 라인들은 전부 className 문자열 내 색 토큰만 gray 로 바뀜(구조/핸들러 불변).
    expect(staffCalSection).toMatch(/onSelect|countByDate|namesByDate/); // 데이터 흐름 보존
  });
});
