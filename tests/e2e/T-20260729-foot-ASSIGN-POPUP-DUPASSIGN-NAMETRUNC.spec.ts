/**
 * E2E spec — T-20260729-foot-ASSIGN-POPUP-DUPASSIGN-NAMETRUNC
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1785307271.194719):
 *   일누적 배정(초진) 팝업 버그 2건.
 *   Bug B(P0): 장홍석(F-5247) 담당=강경민인데 최현희 팝업에도 동시 노출 → 1환자 2실장 이중응대 위험.
 *   Bug A(P1): 팝업 성함이 '장홍석'→'홍석'(성 누락)으로 표기.
 *
 * diagnosis-first 진단 결과 (prod READ-ONLY, scripts/..._diag.mjs):
 *   Bug B = 원인 (a) FE 쿼리.
 *     RC = staffStats 배정 집계 소스 monthCheckIns 는 deleted_at IS NULL 만 필터(status 무관, '누적 done 포함' 의도).
 *          → status='cancelled' 이면서 soft-hide 안 된 check_in 이 배정 팝업/카운트에 유령 잔존.
 *          F-5247: 최현희 check_in(cancelled) + 강경민 check_in(done) 공존 → 두 실장 팝업 동시 노출.
 *          당월 유령배정 후보 9건(cancelled & deleted_at null & consultant_id 有).
 *     Fix = 배정 집계 루프에서 status='cancelled' 배제(done 유지). 데이터 정정 불요(코드-side).
 *   Bug A = 원인 로컬 스냅샷 staleness (렌더 코드 결함 아님).
 *     RC = 팝업이 check_ins.customer_name(등록시점 스냅샷)을 읽음. F-5247 스냅샷='홍석'인데 customers.name='장홍석'.
 *          당월 439건 중 3건만 불일치(홍석/장홍석·박경숙/박경수·김구엽⁰/김구엽) → 렌더 결함 아님(436건 정상).
 *     Fix = 팝업 성함을 customers.name(정본) live 로 우선 소싱(chart_number 와 동일 경로), 스냅샷 fallback.
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(형제 foot spec 동형).
 * 실렌더/클릭·prod 데이터 재현 검증은 supervisor 맥스튜디오 실브라우저(갤탭) field-soak 단계에서 보강.
 * (인접 JINRYO 티켓이 dev/QA 9/9 PASS 후 field-soak 재현실패로 reopen된 전례 — 실기기 confirm 전 종결 금지.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: Bug B — 취소 배정 유령 제외 (중복배정 재현 불가)
// ─────────────────────────────────────────────────────────────────────────────
test('BugB-1: 배정 집계 루프에서 status=cancelled check_in 배제', () => {
  const src = read(PAGE);
  // staffStats 의 monthCheckIns 순회 루프 안에 cancelled skip guard 존재
  const loop = src.slice(src.indexOf('for (const ci of monthCheckIns)'));
  expect(loop).toMatch(/if\s*\(\s*ci\.status\s*===\s*'cancelled'\s*\)\s*continue;/);
});

test('BugB-2: 취소 배제 guard 는 구간(inDay/inMonth) skip 직후, 배정 attribution 이전에 위치', () => {
  const src = read(PAGE);
  const loopStart = src.indexOf('for (const ci of monthCheckIns)');
  const seg = src.slice(loopStart);
  const idxRangeSkip = seg.indexOf('!inDay(ms) && !inMonth(ms))');
  const idxCancelSkip = seg.indexOf("ci.status === 'cancelled'");
  const idxConsultAttr = seg.indexOf('if (ci.consultant_id)');
  expect(idxRangeSkip).toBeGreaterThan(-1);
  expect(idxCancelSkip).toBeGreaterThan(idxRangeSkip); // 구간 skip 뒤
  expect(idxConsultAttr).toBeGreaterThan(idxCancelSkip); // 배정 attribution 앞
});

test('BugB-3: done 은 배제하지 않음(완료 배정 유지) — cancelled 만 배제', () => {
  const src = read(PAGE);
  const loop = src.slice(src.indexOf('for (const ci of monthCheckIns)'), src.indexOf('// 토스(넘긴 사람)'));
  // 루프 내에서 done 을 continue 로 배제하지 않음
  expect(loop).not.toMatch(/ci\.status\s*===\s*'done'\s*\)\s*continue;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: Bug A — 팝업 성함 풀네임(customers.name live 우선)
// ─────────────────────────────────────────────────────────────────────────────
test('BugA-1: itemFromCi 성함 = customers.name(정본) 우선, customer_name 스냅샷 fallback', () => {
  const src = read(PAGE);
  // cust?.name ?? ci.customer_name 순서(정본 우선)
  expect(src).toMatch(/name:\s*\(cust\?\.name\s*\?\?\s*ci\.customer_name\s*\?\?\s*'—'\)/);
});

test('BugA-2: CustomerLite 에 name 필드 추가 + customers select 에 name 포함(2 경로)', () => {
  const src = read(PAGE);
  // 타입에 name 필드
  expect(src).toMatch(/interface CustomerLite\s*\{[\s\S]*?\bname:\s*string \| null;/);
  // 두 customers select 모두 name 을 포함(오늘 custMap + 당월 monthCustMap)
  const selects = src.match(/\.select\('id, name, visit_type, lead_source, visit_route, assigned_staff_id, chart_number'\)/g) ?? [];
  expect(selects.length).toBe(2);
});

test('BugA-3: 구(舊) 소스(ci.customer_name 단독)로 회귀하지 않음', () => {
  const src = read(PAGE);
  // itemFromCi 에서 name: ci.customer_name ?? '—' (정본 미참조) 잔존 금지
  expect(src).not.toMatch(/name:\s*ci\.customer_name\s*\?\?\s*'—',/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 회귀 가드 (REDEFINITION_RISK — 인접 ATTENDANCE-FILTER / STAFFCUMUL 티켓)
// ─────────────────────────────────────────────────────────────────────────────
test('회귀-1: chart_number 는 여전히 customers 정본 live 소싱(성함과 동일 경로)', () => {
  const src = read(PAGE);
  expect(src).toContain('chartNumber: cust?.chart_number ?? null,');
});

test('회귀-2: monthCheckIns 쿼리는 deleted_at null 필터 유지(soft-hide 정합) — 쿼리단 status 필터 추가로 인한 audit 소스 축소 없음', () => {
  const src = read(PAGE);
  // 5b) monthCiRows 쿼리에 deleted_at null 유지, status not-in 필터를 쿼리에 넣지 않음(ciById audit join 보존)
  const qs = src.indexOf('const { data: monthCiRows }');
  const q = src.slice(qs, src.indexOf('const monthCi =', qs));
  expect(q).toContain(".is('deleted_at', null)");
  expect(q).not.toContain("not('status', 'in', '(done,cancelled)')");
});

test('회귀-3: 토스/당김 audit 경로는 monthCheckIns(ciById) 전량 join 유지(cancelled 루프 배제와 무관)', () => {
  const src = read(PAGE);
  expect(src).toContain('const ciById = new Map<string, CheckIn>(monthCheckIns.map((c) => [c.id, c]));');
});
