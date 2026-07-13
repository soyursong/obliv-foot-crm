/**
 * T-20260713-foot-CONSULT-AXIS-RECENCY-UNIFY  (P2, NEW-TASK MSG-20260713-093004-hqlb)
 *
 * 배정축(deriveConsultAxis) · 고객차트 초진/재진 배지의 판정 기준을
 * stored customers.visit_type → 동적 365일 recency(해당 풋센터 최근 완료방문)로 통일.
 * CEO 확정 정의(A안): "1년 이내 해당 센터 방문한 적이 있으면 재진".
 *
 * ⚠ recency 판정 산식은 JUDGE-365(접수분류, prod LIVE) 헬퍼(classifyVisitByRecency /
 *   resolveVisitTypeByRecency)를 재사용 — 접수분류·배정축·배지 세 축이 동일 소스(single source).
 *   신규 중복 구현 금지(AC-2). 라우팅 목적지는 본 스코프 아님(AC-5, 미변경).
 *
 * 검증(순수 함수 + 배선 정적):
 *   AC-1  deriveConsultAxis 입력이 recency 판정 결과(engine 이 resolveVisitTypeByRecency 사용).
 *   AC-2  배치 헬퍼(resolveVisitTypesByRecency)가 classifyVisitByRecency 재사용 = 동일 산식.
 *   AC-3  고객차트 배지가 recency 판정 결과 사용(stored visit_type 직결 회귀 차단).
 *   AC-4  경계값(365/366)·무이력 = JUDGE-365 규약 동일 재확인.
 *   AC-5  라우팅 목적지 코드 미변경(engine 의 상태 매핑 문구 보존).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { classifyVisitByRecency, RETURNING_WINDOW_DAYS } from '../../src/lib/visitRecency';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOASSIGN = path.resolve(__dirname, '../../src/lib/autoAssign.ts');
const VISITRECENCY = path.resolve(__dirname, '../../src/lib/visitRecency.ts');
const CHARTPAGE = path.resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');
const ASSIGNMENTS = path.resolve(__dirname, '../../src/pages/Assignments.tsx');
const NEWCHECKIN = path.resolve(__dirname, '../../src/components/NewCheckInDialog.tsx');
const read = (p: string) => fs.readFileSync(p, 'utf-8');

const TODAY = '2026-07-13';
function daysAgoISO(todayISO: string, n: number): string {
  const t = Date.parse(`${todayISO}T00:00:00Z`);
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

test.describe('T-20260713 CONSULT-AXIS-RECENCY-UNIFY — 순수 판정(동일 산식 재확인)', () => {
  // ── AC-4: 경계·무이력 (JUDGE-365 규약과 동일해야 함) ──
  test('AC-4: 365일=재진 / 366일=초진 / 무이력=초진 (JUDGE-365 동일)', () => {
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 300), TODAY)).toBe('returning'); // 시나리오1
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 400), TODAY)).toBe('new'); // 시나리오2(초진 수렴)
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 365), TODAY)).toBe('returning'); // 경계 포함
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 366), TODAY)).toBe('new');
    expect(classifyVisitByRecency(null, TODAY)).toBe('new'); // 첫 방문
    expect(RETURNING_WINDOW_DAYS).toBe(365);
  });
});

test.describe('T-20260713 CONSULT-AXIS-RECENCY-UNIFY — 배선/회귀 정적 가드', () => {
  // ── AC-2: 배치 헬퍼가 동일 산식(classifyVisitByRecency) 재사용 ──
  test('AC-2: resolveVisitTypesByRecency 가 classifyVisitByRecency 를 재사용(중복 구현 없음)', () => {
    const src = read(VISITRECENCY);
    expect(src).toContain('export async function resolveVisitTypesByRecency');
    // 배치판도 판정은 단일 순수함수로 위임(동일 산식)
    expect(src).toMatch(/resolveVisitTypesByRecency[\s\S]*classifyVisitByRecency\(/);
    // 조회 실패 폴백은 single 헬퍼와 동일(returning)
    expect(src).toMatch(/resolveVisitTypesByRecency[\s\S]*'returning'/);
  });

  // ── AC-1: 배정 엔진(autoAssign)이 recency 판정을 축/필터/reason 단일 소스로 사용 ──
  test('AC-1: autoAssign 엔진이 resolveVisitTypeByRecency 로 축을 파생(stored visit_type 직결 제거)', () => {
    const src = read(AUTOASSIGN);
    expect(src).toContain("import { resolveVisitTypeByRecency } from './visitRecency'");
    expect(src).toContain('const recencyVisitType = await resolveVisitTypeByRecency(checkIn.customer_id, checkIn.clinic_id)');
    // deriveConsultAxis 입력 visit_type 을 recency 로 override
    expect(src).toContain("deriveConsultAxis({ ...(customer ?? {}), visit_type: recencyVisitType })");
    // capability 필터·reason 판정도 동일 소스
    expect(src).toContain('filterTherapistPoolByTreatmentCapability(pool, checkInId, recencyVisitType)');
    expect(src).toContain('visitType: recencyVisitType,');
    // 회귀 차단: 축 파생이 stored visit_type 을 직접 읽던 옛 형태 부재
    expect(src).not.toContain('? deriveConsultAxis(customer ?? {})');
  });

  test('AC-1b: logRealAssignment(실배정 사후기록) 상담 축도 recency 사용', () => {
    const src = read(AUTOASSIGN);
    // 실배정 사후기록 경로도 opts.checkIn 을 소스로 recency 판정 사용
    expect(src).toMatch(/resolveVisitTypeByRecency\(\s*opts\.checkIn\.customer_id,\s*opts\.checkIn\.clinic_id,?\s*\)/);
    expect(src).toContain('deriveConsultAxis({ ...(customer ?? {}), visit_type: recencyVisitType })');
    // 옛 형태(stored 직결) 부재
    expect(src).not.toContain('axis = deriveConsultAxis(customer ?? {});');
  });

  // ── AC-3: 고객차트 배지가 recency 판정 결과 사용 ──
  test('AC-3: CustomerChartPage 배지가 recency(resolveVisitTypeByRecency) 판정 사용', () => {
    const src = read(CHARTPAGE);
    expect(src).toContain("import { resolveVisitTypeByRecency } from '@/lib/visitRecency'");
    expect(src).toContain('const [recencyVisitType, setRecencyVisitType] = useState<VisitType | null>(null)');
    expect(src).toContain('void resolveVisitTypeByRecency(customerId, cid)');
    // 배지가 recency 값(폴백 stored)을 사용
    expect(src).toContain('const badgeVt = recencyVisitType ?? customer.visit_type');
    expect(src).toContain("badgeVt === 'new' ? 'teal' : 'secondary'");
    // 회귀 차단: 배지가 customer.visit_type 을 직접 variant 로 쓰던 옛 형태 부재
    expect(src).not.toContain("variant={customer.visit_type === 'new' ? 'teal' : 'secondary'}");
  });

  // ── AC-3(연계): 배정 화면 축도 recency 로 수렴 ──
  test('AC-3b: Assignments 상담 축 입력이 recency 배치 판정으로 override', () => {
    const src = read(ASSIGNMENTS);
    expect(src).toContain("import { resolveVisitTypesByRecency } from '@/lib/visitRecency'");
    expect(src).toContain('await resolveVisitTypesByRecency(custIds, clinic.id)');
    expect(src).toContain('await resolveVisitTypesByRecency(monthCustIds, clinic.id)');
    expect(src).toContain('custMap.set(id, { ...cu, visit_type: vt })');
  });

  // ── NewCheckInDialog 내부 divergence 제거: 축 파생 visit_type = recency visitType ──
  test('AC-2b: NewCheckInDialog 상담 축 파생이 이미 확정된 recency visitType 사용(stored 재조회 제거)', () => {
    const src = read(NEWCHECKIN);
    expect(src).toContain('visit_type: visitType,');
    // 축 파생용 stored visit_type 재조회 select 부재(lead_source/visit_route 만 조회)
    expect(src).not.toContain(".select('visit_type, lead_source, visit_route')\n            .eq('id', customerId ?? '')");
  });

  // ── AC-5: 라우팅 목적지 매핑 불변(분류 기준만 교체) ──
  test('AC-5: 라우팅 목적지 코드 미변경 — consult_waiting/treatment_waiting 매핑 보존', () => {
    const src = read(AUTOASSIGN);
    expect(src).toContain("newStatus === 'consult_waiting' ? 'consult'");
    expect(src).toContain("newStatus === 'treatment_waiting' ? 'therapy'");
  });
});
