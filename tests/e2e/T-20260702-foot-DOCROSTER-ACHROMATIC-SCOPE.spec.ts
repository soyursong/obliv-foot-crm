/**
 * E2E spec — T-20260702-foot-DOCROSTER-ACHROMATIC-SCOPE
 *   의사 근무표(DutyRosterTab) warm(teal/amber) 램프 → 무채색 gray.
 *
 * ── 배경(FOLLOWUP ev3t): 사이드바 '근무 캘린더' = /admin/handover 단일 페이지.
 *   같은 페이지 하단 '직원 근무 캘린더' 섹션은 sibling(commit aa7026d1)으로 이미 회색화 배포됐으나,
 *   최상단 DutyRosterTab(의사 근무표)에 teal/amber 9곳이 잔존 → 현장 '브라운 복수'의 진짜 대상.
 *
 * ── 왜 브라운인가(핵심): tailwind.config.js 가 teal 램프를 오버라이드한다.
 *   teal-600 = #6E6353 (R110 G99 B83, R-B=+27 = Umber 브라운), teal-800 = #443A35 (R-B=+15).
 *   즉 DutyRosterTab 의 teal-600/800 텍스트·활성색은 실제로 브라운으로 렌더됐다.
 *   gray-* 는 config 미오버라이드 → tailwind 기본 cool-neutral 램프(R-B≤0). 전부 gray-* 로 치환.
 *
 * ── AC:
 *   AC1: DutyRosterTab 색 소스에서 teal / amber 클래스 0건(관측 9곳 전부).
 *   AC2 무접촉(회귀 0): 가로폭(w-28·px-2/px-3·whitespace-nowrap = COLWIDTH ebbd5c3c),
 *        세로컴팩트(th py-1·이름 td py-0.5·셀 h-8 = VCOMPACT 4ac5e8da),
 *        헤더 '원장님' 라벨 제거(코너 공란). 데이터·정렬·필터·토글·전주복사 로직 무변경.
 *   AC3(computed): 치환된 gray 토큰의 tailwind 기본 hex 가 전부 cool/중립(R-B≤0).
 *        구 teal 계열 Umber(R-B≈+27)는 소스에서 소멸. → 실브라우저 육안 회색·prod 번들 해시
 *        변경은 supervisor QA + 현장(김주연 총괄) 재확인 게이트(정적 grep 단독 신뢰 금지, field-soak fail 2회 계보).
 *   AC4: 순수 FE className — DB/DDL/RPC 무변경.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/components/DutyRosterTab.tsx');
const full = readFileSync(SRC, 'utf8');

// className 문자열만 대상(주석에 남은 'teal/amber' 서술어 제외) — 실제 코드 라인만 스캔.
const codeLines = full
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
  .join('\n');

test.describe('T-20260702-foot-DOCROSTER-ACHROMATIC-SCOPE — 의사 근무표 warm→무채색', () => {
  // ── AC1: teal/amber 클래스 소멸(9곳) ──
  test('AC1: DutyRosterTab className teal-*/amber-* 0건', () => {
    expect(codeLines).not.toMatch(/\bteal-\d/);
    expect(codeLines).not.toMatch(/\bamber-\d/);
  });

  test('AC1: 무채색 gray-* 치환 존재(배지·오늘·칩·hover)', () => {
    expect(codeLines).toMatch(/bg-gray-200 text-gray-800 border-gray-400/); // regular 배지
    expect(codeLines).toMatch(/bg-gray-100 text-gray-600 border-gray-300/); // part 배지
    expect(codeLines).toMatch(/border-gray-400 bg-gray-100/);               // 오늘 배너 활성
    expect(codeLines).toMatch(/hover:border-gray-400 hover:text-gray-500 hover:bg-gray-100\/50/); // 빈 셀 hover
    expect(codeLines).toMatch(/bg-gray-100\/60/);                           // 오늘 컬럼 셀 bg
  });

  // ── AC2: 의미색 보존 + 레이아웃 앵커 무접촉 ──
  test('AC2: 의미색(삭제/퇴사 red) 보존', () => {
    expect(codeLines).toMatch(/bg-red-100 text-red-700 border-red-300/); // resigned/퇴사
  });

  test('AC2: 가로폭(COLWIDTH ebbd5c3c) 앵커 유지', () => {
    expect(codeLines).toMatch(/table[^>]*className="w-full border-collapse text-sm"/);
    expect(codeLines).toMatch(/w-28 border-b border-r px-3 py-1/);          // 이름 컬럼 폭
    expect(codeLines).toMatch(/overflow-auto rounded-lg border bg-background px-2/); // 표 옆 여백
    expect((codeLines.match(/whitespace-nowrap/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('AC2: 세로컴팩트(VCOMPACT 4ac5e8da) 앵커 유지', () => {
    expect(codeLines).toMatch(/px-3 py-0\.5 text-sm font-medium whitespace-nowrap/); // 이름 td 세로 컴팩트
    expect(codeLines).toMatch(/h-8 w-full min-w-\[3rem\] rounded-md border/);        // 셀 버튼 높이
    // 헤더 '원장님' 라벨 제거: name-col th 는 자식 텍스트 없이 aria-label 만.
    expect(codeLines).toMatch(/data-testid="duty-roster-name-col"/);
    expect(codeLines).not.toMatch(/>원장님</);
  });

  test('AC2: 데이터·토글·전주복사 로직 무변경(핸들러·쿼리 보존)', () => {
    expect(codeLines).toMatch(/duty_roster_week/);       // 주간 쿼리 키
    expect(codeLines).toMatch(/nextRosterType/);         // 3단 토글
    expect(codeLines).toMatch(/copyPrevWeek/);           // 전주 복사
    expect(codeLines).toMatch(/handleToggle/);
  });

  // ── AC3(computed): 치환 gray 토큰 = tailwind 기본 cool-neutral(R-B≤0), 구 teal Umber(R-B≈+27) 소멸 ──
  test('AC3: 사용된 gray 토큰의 computed hex 가 전부 R-B ≤ 0 (cool/중립)', () => {
    // tailwind v3 기본 gray 램프(config 미오버라이드 → 그대로 적용).
    const TW_GRAY: Record<string, string> = {
      '50': '#f9fafb', '100': '#f3f4f6', '200': '#e5e7eb', '300': '#d1d5db',
      '400': '#9ca3af', '500': '#6b7280', '600': '#4b5563', '700': '#374151',
      '800': '#1f2937', '900': '#111827',
    };
    const usedShades = Array.from(codeLines.matchAll(/\bgray-(\d{2,3})\b/g)).map((m) => m[1]);
    expect(usedShades.length).toBeGreaterThan(0);
    for (const shade of new Set(usedShades)) {
      const hex = TW_GRAY[shade];
      expect(hex, `gray-${shade} 는 기본 램프에 존재해야 함`).toBeTruthy();
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // cool/중립: R-B ≤ 0 (Umber 브라운은 R-B ≈ +27). 잔존 0 을 수치로 보증.
      expect(r - b, `gray-${shade}(${hex}) R-B`).toBeLessThanOrEqual(0);
    }
  });

  // ── AC4: 순수 FE ──
  test('AC4: DB/DDL/RPC 무변경 — supabase 접근 패턴 색 치환과 독립', () => {
    expect(codeLines).toMatch(/from\('duty_roster'\)/); // 데이터 접근 보존(색과 무관)
  });
});
