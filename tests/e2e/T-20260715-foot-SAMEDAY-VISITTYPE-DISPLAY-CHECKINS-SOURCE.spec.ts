/**
 * T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE  (P1, NEW-TASK MSG-20260715-115401-iwdh)
 *
 * 당일 방문 초진/재진 **표기 소스**를 customers.visit_type(가변, [완료] 이동 시 'returning' 승격 =
 * '다음 방문' 예측용)에서 **check_ins.visit_type(접수 당시 스냅샷)** 으로 교정.
 *
 * 증상: 금일 초진 고객을 [완료]로 이동하면 promoteVisitTypeToReturning() 가 customers.visit_type 을
 *   new→returning 승격 → 일마감(결제내역)·2번차트 배지가 당일 방문을 [재진]으로 오표시.
 * 정책: 당일 표기는 접수 스냅샷(check_ins.visit_type) 기준. customers.visit_type 승격은 당일 집계·표시에
 *   영향 X. 승격 자체는 의도된 동작(T-20260602)이므로 유지.
 *
 * 검증(순수 함수 + 배선 정적 — 본 도메인 recency 스펙 관례):
 *   AC1  Closing.tsx 일마감 결제내역 초진/재진 = check_ins.visit_type. customers.visit_type 직접참조(단독) 제거.
 *   AC2  visitRecency 헬퍼(single+batch)가 recency 조회에서 '당일 자기방문' 제외(todaySeoulMidnightISO 하한).
 *   AC3  1번차트/접수판정 회귀 없음 — JUDGE-365 접수 배선·분류 산식 불변.
 *   시나리오3  진짜 재진(당일 이전 완료방문)은 그대로 재진 — classifyVisitByRecency 경계 불변.
 *
 * ⚠ GO_WARN: AC2 는 JUDGE-365(deployed b0522329)와 shared visitRecency 헬퍼 공유.
 *   "당일 자기방문 제외"만 추가하고 접수화면 판정을 회귀시키지 않는다(AC3/시나리오3 가 강제).
 * db_change=false · 무-DDL · READ 경로 표시-로직만.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  classifyVisitByRecency,
  diffDaysISO,
  RETURNING_WINDOW_DAYS,
} from '../../src/lib/visitRecency';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOSING = path.resolve(__dirname, '../../src/pages/Closing.tsx');
const RECENCY = path.resolve(__dirname, '../../src/lib/visitRecency.ts');
const DIALOG = path.resolve(__dirname, '../../src/components/NewCheckInDialog.tsx');
const read = (p: string) => fs.readFileSync(p, 'utf-8');

const TODAY = '2026-07-15';
function daysAgoISO(todayISO: string, n: number): string {
  const t = Date.parse(`${todayISO}T00:00:00Z`);
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

test.describe('T-20260715 SAMEDAY-VISITTYPE — AC1 Closing 표기 소스=check_ins', () => {
  test('AC1: 단건 결제 행 초진/재진이 check_ins.visit_type(ci)·당일 check_in(customer_id) 기준으로 도출', () => {
    const src = read(CLOSING);
    // 당일 check_in 스냅샷 lookup 맵 존재
    expect(src).toContain('checkInVisitTypeByCustomer');
    // 단건 결제: check_in_id 직결(ci) 우선 → customer_id 폴백 → 최후 customers.visit_type
    expect(src).toMatch(/visit_type_label:\s*visitTypeLabel\(\s*ci\?\.visit_type/);
    expect(src).toContain('checkInVisitTypeByCustomer.get(customerId)');
  });

  test('AC1b: 패키지 결제 행도 당일 check_in(customer_id) 스냅샷 기준', () => {
    const src = read(CLOSING);
    expect(src).toContain('checkInVisitTypeByCustomer.get(p.customer_id)');
  });

  test('AC1c: 회귀 차단 — customers.visit_type 단독 직접참조(옛 오염 경로) 부재', () => {
    const src = read(CLOSING);
    // 옛 코드: visit_type_label: visitTypeLabel(cust?.visit_type ?? null) — 승격값 직결 오염원.
    expect(src).not.toContain('visit_type_label: visitTypeLabel(cust?.visit_type ?? null)');
    // enrichedRows 재계산 의존성에 스냅샷 맵 포함
    expect(src).toContain('checkInVisitTypeByCustomer, customerMap, staffMap]');
  });
});

test.describe('T-20260715 SAMEDAY-VISITTYPE — AC2 recency 당일 자기방문 제외', () => {
  test('AC2: single+batch 조회 모두 당일 방문 하한 필터(todaySeoulMidnightISO) 적용', () => {
    const src = read(RECENCY);
    expect(src).toContain('function todaySeoulMidnightISO()');
    expect(src).toContain("`${todaySeoulISODate()}T00:00:00+09:00`");
    // single + batch 두 곳에서 done 조회에 .lt(checked_in_at, todaySeoulMidnightISO()) 적용
    const occurrences = src.match(/\.lt\('checked_in_at',\s*todaySeoulMidnightISO\(\)\)/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  test('AC2b: 하한 필터가 status=done done-조회에만 붙고 경계 규칙 상수 불변', () => {
    const src = read(RECENCY);
    // done 조회 유지(제외는 '당일'만, 완료방문 전제 자체는 불변)
    expect(src).toContain(".eq('status', 'done')");
    // 판정 산식 불변
    expect(RETURNING_WINDOW_DAYS).toBe(365);
  });
});

test.describe('T-20260715 SAMEDAY-VISITTYPE — AC3/시나리오3 JUDGE-365 회귀 없음', () => {
  test('시나리오3: 진짜 재진(당일 이전 완료방문)은 그대로 재진 — 분류 경계 불변', () => {
    // 당일 방문은 recency 조회에서 제외되므로, 판정에 들어오는 건 '당일 이전' 완료방문뿐.
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 1), TODAY)).toBe('returning');
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 30), TODAY)).toBe('returning');
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 365), TODAY)).toBe('returning'); // 경계 포함
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 366), TODAY)).toBe('new');       // off-by-one 불변
  });

  test('AC3: 완료이력 무 → 초진취급, diffDaysISO 정확성 불변', () => {
    expect(classifyVisitByRecency(null, TODAY)).toBe('new');
    expect(diffDaysISO('2025-07-15', '2026-07-15')).toBe(365);
    expect(diffDaysISO('2026-07-14', '2026-07-15')).toBe(1);
  });

  test('AC3b: 접수화면(NewCheckInDialog) recency 배선 불변 — 접수판정 회귀 차단', () => {
    const src = read(DIALOG);
    expect(src).toContain("import { resolveVisitTypeByRecency } from '@/lib/visitRecency'");
    expect(src).toContain('await resolveVisitTypeByRecency(p.id, clinicId)');
    // 무조건 재진 하드코딩 재유입 차단(옛 동기 핸들러 회귀 방지)
    expect(src).not.toContain('const handlePatientSelect = (p: PatientMatch) => {');
  });
});
