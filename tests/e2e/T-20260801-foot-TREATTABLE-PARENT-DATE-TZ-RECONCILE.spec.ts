/**
 * E2E Spec — T-20260801-foot-TREATTABLE-PARENT-DATE-TZ-RECONCILE (P2, planner)
 *
 * 치료테이블 부모(TreatmentTable) '오늘' 판정 근원 2축 정합. GUNBLOOD-RECUR(d9f96f54) 조사 부수발견:
 *   자식(ExamTargetsSection) day-aware self-heal 이 흡수 못하는 부모측 근원을 별도 축으로 정합한다.
 *
 *   축1 (tz 불일치 — off-by-one 잠복):
 *     기존 부모 todayStr() = date-fns format(new Date()) = 브라우저 local tz.
 *     자식 = seoulISODate/todaySeoulISODate = KST(Asia/Seoul).
 *     태블릿 OS tz 가 KST 가 아니면 부모·자식의 '오늘'이 하루 어긋날 수 있었다.
 *     → 부모를 todaySeoulISODate()(KST) 로 통일해 근원 제거(부모==자식 동일 일자).
 *
 *   축2 (부모 date 마운트 동결 — 오버나이트 전탭 staleness):
 *     기존 부모 date state 는 마운트 시점 today 로 동결. 풋센터는 태블릿을 24시간 상시 켜두므로
 *     세션이 자정을 넘기면 부모 기준일이 어제로 고정 → 부모 date 를 소비하는 모든 탭
 *     (DoctorHistorySection / DiagDocSection / ExamTargetsSection / BloodDailyListSection /
 *      ProgressTargetsSection)이 어제 기준으로 stale.
 *     → 60s 틱으로 재렌더를 보장(자식 refetchInterval 재렌더 의존 X)하고, 현재일(KST)이 실제로
 *     바뀔 때(하루 1회)만 발화하며, '오늘'을 추종 중이던 경우(직전 date == 직전 today)에만
 *     date 를 새 오늘로 전진 → 전 탭 staleness 해소. 수동 과거선택은 보존.
 *
 * 금지선(가드):
 *   - 청구/계산 무접촉 / 영속데이터 무변경(클라 날짜판정·state 만).
 *   - 사용자가 수동 선택한 과거 날짜를 롤오버가 임의로 덮지 않음.
 *   - GUNBLOOD-RECUR 자식 self-heal 무회귀([균검사] 당일 펼침 유지).
 *
 * AC:
 *   AC-1: 부모 '오늘' 판정 == 자식 '오늘' 판정 (동일 KST 일자, off-by-one 없음) — tz≠KST 환경 포함.
 *   AC-2: 오버나이트 롤오버 후 '오늘 추종' 세션의 부모 date 가 새 오늘로 전진 → 전 탭 새 기준일 소비.
 *   AC-3: 사용자가 수동 선택한 과거 날짜는 롤오버로 덮이지 않음(보존).
 *   AC-4: 같은 날 재렌더(today 불변)는 date 무발화(수동 선택 보존, 재간섭 없음).
 *   AC-5: FE-only — 부모 롤오버 이펙트에 신규 write/RPC/DDL 경로 없음(db_change=false).
 *   AC-6: 자식 GUNBLOOD-RECUR day-aware self-heal 무회귀(정적 가드).
 *
 * 구성:
 *   A. 순수 로직 — 부모가 쓰는 실제 todaySeoulISODate + 동일 date-follow reconcile 재현(시나리오1 tz정합/시나리오2 롤오버).
 *   B. 정적 소스 가드 — tz 통일/day-aware 이펙트/date 전진 조건/write 미접점/자식 self-heal 존치를 소스에서 단언.
 *
 * 실행: npx playwright test T-20260801-foot-TREATTABLE-PARENT-DATE-TZ-RECONCILE.spec.ts --project=desktop-chrome
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { todaySeoulISODate, seoulISODate } from '../../src/lib/format';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARENT_SRC = () =>
  readFileSync(join(HERE, '../../src/pages/TreatmentTable.tsx'), 'utf-8');
const CHILD_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/ExamTargetsSection.tsx'), 'utf-8');

// ── 부모 date-follow reconcile 재현(drift 방지) ───────────────────────────
// 축2 이펙트 동작: today 가 prevToday 와 다르고, 현재 date 가 prevToday(='오늘 추종')면 새 오늘로 전진.
function reconcileDate(curDate: string, prevToday: string, curToday: string): string {
  if (prevToday === curToday) return curDate; // 같은 날 — 무발화
  return curDate === prevToday ? curToday : curDate; // 추종 중이면 전진, 수동 과거선택은 보존
}

test.describe('T-20260801-foot-TREATTABLE-PARENT-DATE-TZ-RECONCILE — A. 순수 로직', () => {
  // ── 시나리오 1: tz 정합 (부모 == 자식 '오늘') ──
  test('AC-1: 부모 todaySeoulISODate() == 자식 seoulISODate(new Date()) (동일 KST 일자)', () => {
    // 부모(신) 와 자식이 같은 KST 산출식 → 항상 동일 일자(off-by-one 없음).
    const parentToday = todaySeoulISODate();
    const childToday = seoulISODate(new Date());
    expect(parentToday).toBe(childToday);
    expect(parentToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('AC-1: KST 경계 시각에도 부모==자식 (local tz 와 무관, off-by-one 차단)', () => {
    // 자식이 쓰는 seoulISODate 와 동일 산출을 부모가 재현 — 경계 UTC 시각 대조.
    // (구 부모 date-fns local-tz 였다면 실행환경 tz 에 따라 이 일자가 어긋날 수 있었음.)
    expect(seoulISODate(new Date('2026-07-31T16:00:00Z'))).toBe('2026-08-01'); // 01:00 KST(자정 직후)
    expect(seoulISODate(new Date('2026-08-01T14:59:00Z'))).toBe('2026-08-01'); // 23:59 KST(자정 직전)
    expect(seoulISODate(new Date('2026-08-01T15:00:00Z'))).toBe('2026-08-02'); // 00:00 KST(경계 넘김)
  });

  // ── 시나리오 2: 오버나이트 롤오버 (전 탭 staleness 해소) ──
  test('AC-2: 오버나이트 롤오버 — 오늘 추종 세션의 부모 date 가 새 오늘로 전진', () => {
    const yesterday = '2026-07-31';
    const today = '2026-08-01';
    // 어제 마운트, 사용자는 오늘(당일)을 보고 있었음 → date == 마운트 today == yesterday.
    let date = yesterday;
    // 구 동작: date 동결 → 자정 넘겨도 date 는 yesterday(전 탭 stale).
    expect(date).toBe(yesterday);
    // 신 동작: 롤오버 이펙트가 추종 컨텍스트에서 date 를 새 오늘로 전진.
    date = reconcileDate(date, yesterday, today);
    expect(date).toBe(today); // AC-2 — 전 탭이 새 기준일 소비
  });

  test('AC-3: 수동 선택한 과거 날짜는 롤오버로 덮이지 않음(보존)', () => {
    const prevToday = '2026-08-01';
    const curToday = '2026-08-02';
    // 사용자가 과거(07-28) 조회 중 → date != prevToday.
    let date = '2026-07-28';
    date = reconcileDate(date, prevToday, curToday);
    expect(date).toBe('2026-07-28'); // AC-3 — 임의 변경 없음
  });

  test('AC-4: 같은 날 재렌더(today 불변)는 date 무발화', () => {
    const today = '2026-08-01';
    // 60s 틱 재렌더가 여러 번 나도 today 불변이면 date 손대지 않음.
    let date = '2026-07-25'; // 사용자 수동 과거선택 상태
    date = reconcileDate(date, today, today);
    expect(date).toBe('2026-07-25'); // AC-4 — 재간섭 없음
    // 오늘 추종 상태에서도 today 불변이면 무발화(불필요 setState 없음).
    let date2 = today;
    date2 = reconcileDate(date2, today, today);
    expect(date2).toBe(today);
  });
});

test.describe('T-20260801-foot-TREATTABLE-PARENT-DATE-TZ-RECONCILE — B. 정적 소스 가드', () => {
  test('AC-1: 부모 tz 통일 — todaySeoulISODate() 로 today 산출, 구 local-tz todayStr 제거', () => {
    const src = PARENT_SRC();
    // import + 사용 존재.
    expect(src).toMatch(/import\s*\{[^}]*todaySeoulISODate[^}]*\}\s*from\s*'@\/lib\/format'/);
    expect(src).toMatch(/const\s+today\s*=\s*todaySeoulISODate\(\)/);
    // 구 local-tz 산출 함수/식 제거(회귀 차단).
    expect(src).not.toContain('function todayStr');
    expect(src).not.toMatch(/format\(new Date\(\),\s*'yyyy-MM-dd'\)/);
  });

  test('AC-2: 부모 day-aware date 전진 이펙트 존치 — today 변경 시 추종 date 전진', () => {
    const src = PARENT_SRC();
    // 현재일 추적 ref + today 의존 이펙트 + 추종조건 setDate 3요소 존재.
    expect(src).toMatch(/prevTodayRef\s*=\s*useRef\(today\)/);
    expect(src).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*prevTodayRef\.current\s*!==\s*today[\s\S]*setDate[\s\S]*\}\s*,\s*\[today\]\s*\)/);
    // 추종 컨텍스트에서만 전진 — cur === prevToday 조건(수동 과거선택 보존).
    expect(src).toMatch(/cur\s*===\s*prevToday\s*\?\s*today\s*:\s*cur/);
    // useEffect/useRef 임포트 존재.
    expect(src).toMatch(/import\s*\{[^}]*useEffect[^}]*\}\s*from\s*'react'/);
    expect(src).toMatch(/import\s*\{[^}]*useRef[^}]*\}\s*from\s*'react'/);
  });

  test('AC-2: 60s 틱으로 자정 롤오버 자가감지(자식 재렌더 의존 X)', () => {
    const src = PARENT_SRC();
    // setInterval 기반 강제 재렌더 틱 존재 → 부모가 스스로 KST 롤오버 감지.
    expect(src).toMatch(/setInterval\([\s\S]*forceDayTick[\s\S]*60_000\)/);
    expect(src).toContain('clearInterval');
  });

  test('AC-5: FE-only — 부모 롤오버 이펙트 블록에 신규 write/RPC/DDL 경로 없음', () => {
    const src = PARENT_SRC();
    const start = src.indexOf('prevTodayRef');
    const block = src.slice(start, start + 700);
    expect(block).not.toContain('supabase');
    expect(block).not.toContain('.rpc(');
    expect(block).not.toContain('.insert(');
    expect(block).not.toContain('.update(');
    expect(block).not.toContain('.delete(');
  });

  test('AC-6: 자식 GUNBLOOD-RECUR day-aware self-heal 무회귀(존치)', () => {
    const src = CHILD_SRC();
    // 자식 expandedDates day-aware 이펙트 + 초기값 존치(무접촉 확인).
    expect(src).toMatch(/prevTodayRef\s*=\s*useRef\(today\)/);
    expect(src).toContain('next.add(today)');
    expect(src).toMatch(/useState<Set<string>>\(\s*\(\)\s*=>\s*new Set\(\[seoulISODate\(new Date\(\)\)\]\)\s*\)/);
  });
});
