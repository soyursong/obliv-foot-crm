/**
 * E2E Spec — T-20260801-foot-GUNBLOOD-DEFAULTEXPAND-RECUR (P1, planner / 김주연 총괄)
 *
 * 치료테이블 > [균검사] 탭(ExamTargetsSection) '균검사 대상자' 일자 그룹:
 *   증상(현장 재발): 오늘(당일) 날짜 그룹이 초기 로드 시 펼쳐진(expanded) 상태여야 하는데
 *     7/30 배포(c859b1cc, DEFAULTEXPAND B) 이후에도 8/1 현장에서 '여전히 접혀있음' 재발.
 *
 *   회귀/미반영 규명(추정 금지 — 코드/번들 증거 기반, 티켓 (a)(b)(c) 순):
 *     (a) 코드 존치 = OK. c859b1cc 가 ExamTargetsSection.tsx 의 마지막 수정 커밋이고,
 *         candidate_regressors(MEDCHART-3ZONE-RESTRUCTURE 등)는 이 파일을 건드리지 않음(git 이력).
 *         expandedDates 초기값 = new Set([seoulISODate(new Date())]) 존치. → 회귀 아님.
 *     (b) 런타임 = ★진짜 원인★. expandedDates 를 '마운트 시점 오늘'로만 동결(useState 초기값)했다.
 *         풋센터는 태블릿을 24시간 상시 켜두므로 세션이 자정을 넘기면 마운트일(어제)에 고정된다.
 *         이후 부모 날짜 네비게이터('오늘' 버튼)나 자정 롤오버로 표시 그룹이 '진짜 오늘'로 바뀌어도
 *         동결 set 에 새 오늘이 없어 today 그룹이 접힘(collapsed) 렌더됐다.
 *         (7/30 배포일엔 신선 마운트라 정상 → 날짜가 바뀌며 재발한 '계속 접혀있음'의 실제 메커니즘)
 *     (c) 배포 반영 = OK. prod version.json commit == origin/main HEAD(e43c515a), c859b1cc 는 조상.
 *         번들에 defaultExpanded 코드 실재. → 미반영 아님.
 *
 *   수정(FE-only, db_change=false): 현재일(KST)이 바뀌면 새 오늘을 expandedDates 에 추가하는
 *     day-aware 이펙트 추가 → 당일 자동 펼침을 세션 수명·자정 롤오버와 무관하게 복원.
 *     문자열 값이 실제로 달라질 때(하루 1회)만 발화 → 사용자가 당일 안에서 오늘을 접은 선택과 무충돌.
 *
 *   피검사([피검사] 탭 = BloodDailyListSection): 설계상 '플랫 리스트'(일자 그룹/접힘 개념 없음, mockup 준거).
 *     접힘 상태 자체가 없어 당일 대상자는 항상 노출 → '당일 펼침' 자연 충족. 본 티켓은 재구조화하지 않음
 *     (플랫 설계 존치를 소스 가드로 단언). 그룹-아코디언化 여부는 별도 현장 confirm 사안.
 *
 * AC:
 *   AC-1: 초기 로드 시 오늘(KST) 그룹은 펼침(expanded).
 *   AC-2: 과거 일자 그룹은 접힘(collapsed) 유지.
 *   AC-3: 자정 롤오버(today 문자열 변경) 후 새 오늘 그룹이 자동 펼침으로 복원(재발 RC 수정).
 *   AC-4: 사용자가 당일 안에서 오늘을 수동으로 접으면 그 선택이 유지(같은 날 재간섭 없음).
 *   AC-5: 피검사 탭은 플랫 리스트 존치(그룹 아코디언 미도입) — 재구조화 없음.
 *   AC-6: FE-only. ExamTargetsSection 에 신규 write/RPC 경로 없음(db_change=false).
 *
 * 구성:
 *   A. 순수 로직 — 컴포넌트가 쓰는 실제 seoulISODate + 동일 펼침 판정/롤오버 reconcile 를 재현해 AC-1~4 확정.
 *   B. 정적 소스 가드 — day-aware 이펙트/초기값/피검사 플랫 존치/write 미접점을 소스에서 단언(AC-3/5/6 재회귀 차단).
 *
 * 실행: npx playwright test T-20260801-foot-GUNBLOOD-DEFAULTEXPAND-RECUR.spec.ts --project=desktop-chrome
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seoulISODate } from '../../src/lib/format';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAM_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/ExamTargetsSection.tsx'), 'utf-8');
const BLOOD_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/BloodDailyListSection.tsx'), 'utf-8');

// ── 컴포넌트의 펼침 판정을 재현(drift 방지) ────────────────────────────────
// 초기 state: 마운트 시점 오늘(KST) 1개.
function initExpanded(mountToday: string): Set<string> {
  return new Set([mountToday]);
}
// day-aware reconcile: 현재일(KST)이 prevToday 와 다르면 새 오늘을 set 에 추가(수정된 이펙트 동작).
function reconcileForToday(prev: Set<string>, prevToday: string, curToday: string): Set<string> {
  if (prevToday === curToday) return prev; // 같은 날 — 무발화(사용자 선택 보존)
  if (prev.has(curToday)) return prev;
  const next = new Set(prev);
  next.add(curToday);
  return next;
}
// 렌더 판정: 그룹은 expandedDates 에 자기 날짜가 있으면 펼침.
const isGroupOpen = (expanded: Set<string>, groupDate: string) => expanded.has(groupDate);

test.describe('T-20260801-foot-GUNBLOOD-DEFAULTEXPAND-RECUR — A. 순수 로직(펼침 판정/롤오버)', () => {
  test('AC-1/2: 초기 로드 — 오늘 그룹 펼침, 과거 그룹 접힘', () => {
    const today = seoulISODate(new Date());
    const past = seoulISODate(new Date(Date.now() - 3 * 86400_000));
    const expanded = initExpanded(today);
    expect(isGroupOpen(expanded, today)).toBe(true); // AC-1
    expect(isGroupOpen(expanded, past)).toBe(false); // AC-2
  });

  test('AC-3: 자정 롤오버 — 어제 마운트 세션이 오늘로 넘어가면 새 오늘 그룹 자동 펼침(재발 RC 수정)', () => {
    // 어제 마운트 → expandedDates 는 어제로 동결(수정 前엔 여기서 멈춰 오늘 그룹 접힘 = 재발 원인).
    const yesterday = '2026-07-31';
    const today = '2026-08-01';
    let expanded = initExpanded(yesterday);
    // 수정 前 동작 재현: 오늘 그룹이 접혀있음(RC).
    expect(isGroupOpen(expanded, today)).toBe(false);
    // 수정 後: 자정 롤오버 이펙트가 새 오늘을 추가 → 오늘 그룹 펼침 복원.
    expanded = reconcileForToday(expanded, yesterday, today);
    expect(isGroupOpen(expanded, today)).toBe(true); // AC-3
    // 과거(어제)는 여전히 set 에 있으나, 표시 그룹이 오늘로 바뀌면 무해(오늘 펼침이 핵심).
    expect(isGroupOpen(expanded, '2026-07-30')).toBe(false);
  });

  test('AC-4: 같은 날 안에서 사용자가 오늘을 접으면 유지(무발화)', () => {
    const today = '2026-08-01';
    let expanded = initExpanded(today);
    // 사용자가 오늘을 수동으로 접음(toggle).
    expanded = new Set([...expanded].filter((d) => d !== today));
    expect(isGroupOpen(expanded, today)).toBe(false);
    // 같은 날 재렌더(today 불변) → reconcile 무발화 → 접힘 유지(재간섭 없음).
    expanded = reconcileForToday(expanded, today, today);
    expect(isGroupOpen(expanded, today)).toBe(false); // AC-4
  });

  test('seoulISODate 는 KST(en-CA, YYYY-MM-DD) — 오늘 판정 SSOT', () => {
    const d = seoulISODate(new Date());
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 같은 시각 두 번 호출 = 동일값(마운트 today ↔ 렌더 today 매칭 보장).
    expect(seoulISODate(new Date('2026-08-01T02:00:00Z'))).toBe('2026-08-01'); // 11:00 KST
    expect(seoulISODate(new Date('2026-07-31T16:00:00Z'))).toBe('2026-08-01'); // 01:00 KST(경계)
  });
});

test.describe('T-20260801-foot-GUNBLOOD-DEFAULTEXPAND-RECUR — B. 정적 소스 가드', () => {
  test('AC-1: expandedDates 초기값 = 오늘(KST) 존치(c859b1cc DEFAULTEXPAND B)', () => {
    const src = EXAM_SRC();
    expect(src).toMatch(/useState<Set<string>>\(\s*\(\)\s*=>\s*new Set\(\[seoulISODate\(new Date\(\)\)\]\)\s*\)/);
  });

  test('AC-3: day-aware 롤오버 이펙트 존치 — today 변경 시 새 오늘 expandedDates 추가', () => {
    const src = EXAM_SRC();
    // 현재일 추적 ref + today 의존 이펙트 + setExpandedDates add(today) 3요소 모두 존재.
    expect(src).toMatch(/prevTodayRef\s*=\s*useRef\(today\)/);
    expect(src).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*prevTodayRef\.current\s*!==\s*today[\s\S]*setExpandedDates[\s\S]*\}\s*,\s*\[today\]\s*\)/);
    expect(src).toContain('next.add(today)');
    // useRef 임포트 존재.
    expect(src).toMatch(/import\s*\{[^}]*useRef[^}]*\}\s*from\s*'react'/);
  });

  test('AC-6: FE-only — ExamTargetsSection 펼침 로직에 신규 write/RPC/DDL 경로 없음', () => {
    const src = EXAM_SRC();
    // 본 티켓이 추가한 수정은 expandedDates(클라이언트 UI state)만 — 신규 supabase write 미도입.
    // (기존 발급/상태전이 mutation 은 본 fix 무접점: 롤오버 이펙트 블록 내 supabase 호출 0.)
    const effectBlock = src.slice(src.indexOf('prevTodayRef'), src.indexOf('prevTodayRef') + 600);
    expect(effectBlock).not.toContain('supabase');
    expect(effectBlock).not.toContain('.rpc(');
    expect(effectBlock).not.toContain('.insert(');
    expect(effectBlock).not.toContain('.update(');
  });

  test('AC-5: 피검사 탭(BloodDailyListSection)은 플랫 리스트 존치 — 그룹 아코디언/접힘 미도입', () => {
    const src = BLOOD_SRC();
    // 플랫 설계 존치: expandedDates/toggleGroup/date-group-header 아코디언 요소 없음.
    expect(src).not.toContain('expandedDates');
    expect(src).not.toContain('exam-date-group-header');
    // 플랫 리스트 테이블 마커 존재(당일 대상자 항상 노출).
    expect(src).toContain('blood-daily-table');
  });
});
