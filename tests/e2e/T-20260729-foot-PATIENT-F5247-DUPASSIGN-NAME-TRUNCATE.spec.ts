/**
 * E2E spec — T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE
 *
 * 현장(김주연 총괄, 풋센터): 초진 장홍석(F-5247) 배정 팝업 2버그.
 *   A. 중복배정 — 강경민 배정건이 최현희 실장에게도 중복 노출(1환자 2실장).
 *   B. 성 누락 — '장홍석' → '홍석' 표기.
 *
 * ── 진단(prod READ-ONLY, scripts/..._diag.mjs + ..._systemic.mjs) ──
 *   A = 표시/쿼리 결함(데이터 오염 아님). F-5247 = 최현희 check_in(cancelled) + 강경민(done) 2건 공존(정상 재방문).
 *       현행 활성배정 ≥2 환자 = 0(systemic) → RED LINE(assigned_*) 정정·백필 불요.
 *   B = 스냅샷 staleness(렌더 결함 아님). customers.name='장홍석' vs check_ins.customer_name='홍석'. 당월 불일치 3/435.
 *
 * ── 선행 fix(a7885a99, ASSIGN-POPUP-DUPASSIGN-NAMETRUNC, 배포됨) ──
 *   staffStats(누적/드릴 팝업)에만 cancelled 가드 + 정본 성함 소싱 적용.
 *
 * ── 본 티켓 델타 ──
 *   동일 두 버그의 잔여면 = 금일 배분 이력(todayDistribution). 이 표는 (A)cancelled 미배제 + (B)스냅샷 성함 사용으로
 *   유령 중복·성 누락이 잔존(당월 cancelled&non-soft-hide 9건). 두 가드를 이 표에도 일관 적용('활성배정만' 불변식).
 *
 * 정본 소스 정적 단언(형제 foot spec 동형). 실렌더/갤탭 재현은 supervisor field-soak 에서 보강(실기기 confirm 전 종결 금지).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// todayDistribution useMemo 본문만 슬라이스(다른 루프 오염 방지)
function todayDistBody(src: string): string {
  const start = src.indexOf('const todayDistribution = useMemo<TodayDistRow[]>');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('}, [monthCheckIns, actions, activeTab, monthCustomers, axisOf]);', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: Bug A 잔여면 — 금일 배분 이력에서 취소 배정 배제(중복 노출 차단)
// ─────────────────────────────────────────────────────────────────────────────
test('A-1: todayDistribution 루프에 status=cancelled skip 가드 존재', () => {
  const body = todayDistBody(read(PAGE));
  expect(body).toMatch(/if\s*\(\s*ci\.status\s*===\s*'cancelled'\s*\)\s*continue;/);
});

test('A-2: cancelled 가드는 today-window skip 직후, push(consult/therapy) 이전', () => {
  const body = todayDistBody(read(PAGE));
  const idxWindow = body.indexOf('getTime() < todayStartMs) continue;');
  const idxCancel = body.indexOf("ci.status === 'cancelled'");
  const idxPush = body.indexOf("push('consult', ci.consultant_id);");
  expect(idxWindow).toBeGreaterThan(-1);
  expect(idxCancel).toBeGreaterThan(idxWindow);
  expect(idxPush).toBeGreaterThan(idxCancel);
});

test('A-3: done 은 배제하지 않음 — cancelled 만 배제(완료 배정 이력 유지)', () => {
  const body = todayDistBody(read(PAGE));
  expect(body).not.toMatch(/ci\.status\s*===\s*'done'\s*\)\s*continue;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: Bug B 잔여면 — 금일 배분 이력 성함 정본 live 소싱
// ─────────────────────────────────────────────────────────────────────────────
test('B-1: customerName = customers.name(정본) 우선, customer_name 스냅샷 fallback', () => {
  const body = todayDistBody(read(PAGE));
  expect(body).toMatch(/customerName:\s*cust\?\.name\s*\?\?\s*ci\.customer_name\s*\?\?\s*'—',/);
});

test('B-2: 구(舊) 스냅샷 단독 소스(customerName: ci.customer_name ?? \'—\')로 회귀 금지', () => {
  const body = todayDistBody(read(PAGE));
  expect(body).not.toMatch(/customerName:\s*ci\.customer_name\s*\?\?\s*'—',/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 회귀 가드 — 선행 fix(a7885a99) 및 인접 로직 보존
// ─────────────────────────────────────────────────────────────────────────────
test('회귀-1: staffStats(누적/드릴) cancelled 가드 유지(선행 fix 회귀 없음)', () => {
  const src = read(PAGE);
  const staffStats = src.slice(src.indexOf('for (const ci of monthCheckIns)'), src.indexOf('// 토스(넘긴 사람)'));
  expect(staffStats).toMatch(/if\s*\(\s*ci\.status\s*===\s*'cancelled'\s*\)\s*continue;/);
});

test('회귀-2: 드릴 팝업(itemFromCi) 성함 정본 소싱 유지', () => {
  const src = read(PAGE);
  expect(src).toMatch(/name:\s*\(cust\?\.name\s*\?\?\s*ci\.customer_name\s*\?\?\s*'—'\)/);
});

test('회귀-3: monthCheckIns 쿼리는 deleted_at null 필터 유지(쿼리단 status 필터 미추가 — audit join 보존)', () => {
  const src = read(PAGE);
  const qs = src.indexOf('const { data: monthCiRows }');
  const q = src.slice(qs, src.indexOf('const monthCi =', qs));
  expect(q).toContain(".is('deleted_at', null)");
  expect(q).not.toContain("not('status', 'in', '(done,cancelled)')");
});
