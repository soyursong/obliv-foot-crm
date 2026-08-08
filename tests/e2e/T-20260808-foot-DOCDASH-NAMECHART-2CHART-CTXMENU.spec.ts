/**
 * E2E spec — T-20260808-foot-DOCDASH-NAMECHART-2CHART-CTXMENU (P1/foot · ADDITIVE · db_change=false)
 *
 * 현장 요청(planner NEW-TASK MSG-20260808-231650-auwl, 김주연 총괄 C0ATE5P6JTH thread 1786198083.298409):
 *   진료대시보드(DoctorCallDashboard) 성함/차트번호 클릭 → 2번차트 연동 + 셀 우클릭 시 기존 컨텍스트 메뉴 동일 표시.
 *
 * ── 착수 범위(dev-foot, 게이트 준수) ──────────────────────────────────────────
 *   AC-1(차트번호 클릭 → 2번차트): 즉시 착수 — 배포된 공통훅 useChartNoPopup() 재사용(GLOBAL
 *     T-20260804-foot-CHARTNO-CLICK-CHART2-POPUP-GLOBAL 이 진료대시보드만 미커버 → 본 delta).
 *     진료 대기중/완료 두 테이블 차트번호 셀(doctor-call-chartno / doctor-completed-chartno) 배선.
 *   AC-2(이름 클릭 → 2번차트): ★HELD — dev-confirm 게이트(이름-클릭 목적지 = 현재 진료차트 서랍 vs
 *     요청의 2번차트). planner FOLLOWUP 회신 전까지 이름-클릭 동선 무변경(무단 파괴 금지). → 아래 test.skip.
 *   AC-3(우클릭 → 기존 컨텍스트 메뉴 동일): ★HELD — 기준 메뉴 확인 필요(진료대시보드 행=CheckIn →
 *     StatusContextMenu 가 정합, ReservationContextMenu 는 Reservation 필요). 현재 이 화면엔 컨텍스트
 *     메뉴 미배선 + status/flag/room mutation 콜백 배선 = 신규 동작 → planner 재확인 후 착수. → test.skip.
 *
 * 검증 방식(형제 CHARTNO-CLICK-CHART2-POPUP-GLOBAL spec 동형):
 *   정본 소스 정적 단언(데이터/로그인 비의존). 공통 훅 계약 + 진료대시보드 배선을 소스에서 단언한다.
 *   실렌더(차트번호 클릭 → 2번차트 팝업 표출/오환자 없음/행선택 무충돌)는 supervisor 맥스튜디오
 *   실브라우저(갤탭) 단계 보강.
 *
 * §11 의료게이트: 2번차트 = 직원용 미니홈피(useChartNoPopup 훅 주석 명시 §11 비대상). AC-1 은 표시된
 *   차트번호에 클릭 진입점만 additive 부착(문원장 기존 동선 무변경). AC-2/AC-3(문원장 동선 변경/신규
 *   mutation)은 HELD → planner 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const HOOK = 'src/hooks/useChartNoPopup.ts';
const DOCDASH = 'src/components/doctor/DoctorCallDashboard.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// S1 (공통훅 계약 무회귀): 단일 게이트웨이 재사용 + 전파 충돌 방지 + 비활성 no-op.
//   (본 티켓은 훅을 신규 소비만 — 훅 자체 무변경 확인)
// ─────────────────────────────────────────────────────────────────────────────
test('S1: 공통 훅 useChartNoPopup 은 useChart().openChart 단일 게이트 재사용 + stopPropagation + no-op', () => {
  const src = read(HOOK);
  expect(src).toMatch(/const \{ openChart \} = useChart\(\)/);
  expect(src).toMatch(/openChart\(customerId\)/);
  expect(src).toMatch(/e\?\.stopPropagation\(\)/);
  expect(src).toMatch(/if \(!customerId\) return/);
  expect(src).toMatch(/export const CHARTNO_LINK_CLASS =/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 진료대시보드가 공통 훅을 import + 호출(개별 window.open 복제 금지 = 수렴 단언).
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 진료대시보드가 useChartNoPopup + CHARTNO_LINK_CLASS 를 import 하고 호출', () => {
  const src = read(DOCDASH);
  expect(src, '공통 훅 import').toMatch(
    /import \{[^}]*useChartNoPopup[^}]*CHARTNO_LINK_CLASS[^}]*\} from '@\/hooks\/useChartNoPopup'/,
  );
  // 대기/완료 두 행 컴포넌트에서 각각 훅 호출(2회 이상)
  expect(src.match(/useChartNoPopup\(\)/g)?.length ?? 0, '두 테이블 행 컴포넌트에서 훅 호출').toBeGreaterThanOrEqual(2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1(AC-1): 진료 대기중 테이블 차트번호 셀 클릭 → openChartNo(checkIn.customer_id).
// 시나리오 3(엣지): customer_id 없으면 no-op(비활성) + 훅 stopPropagation 으로 부모 전파 분리.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1/S1: 진료 대기중 차트번호(doctor-call-chartno) 클릭 → openChartNo(customer_id) 배선', () => {
  const src = read(DOCDASH);
  expect(src).toMatch(/data-testid="doctor-call-chartno"/);
  expect(src).toMatch(/onClick=\{checkIn\.customer_id \? \(e\) => openChartNo\(checkIn\.customer_id, e\)/);
});

test('AC-1/S1: 진료 완료 차트번호(doctor-completed-chartno) 클릭 → openChartNo(customer_id) 배선', () => {
  const src = read(DOCDASH);
  expect(src).toMatch(/data-testid="doctor-completed-chartno"/);
  expect(src).toMatch(/onClick=\{checkIn\.customer_id \? \(e\) => openChartNo\(checkIn\.customer_id, e\)/);
});

test('AC-1/S3(엣지): customer_id 없으면 onClick undefined(no-op) + CHARTNO_LINK_CLASS 조건부 부착', () => {
  const src = read(DOCDASH);
  // 두 셀 모두 customer_id 없을 때 링크 클래스 미부착(비활성 시각)
  expect(src.match(/checkIn\.customer_id && CHARTNO_LINK_CLASS/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  // 새 window.open 복제 없음(훅 게이트웨이만 소비 — L-004 정합). 주석 스트립 후 검사.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  expect(codeOnly).not.toMatch(/window\.open\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 (HELD — dev-confirm 게이트): 이름-클릭 목적지 결정 회신 전까지 현 동선(진료차트 서랍) 불변.
//   planner FOLLOWUP 회신 후 (a)2번차트 교체 or (b)유지 확정 시 skip 해제.
// ─────────────────────────────────────────────────────────────────────────────
test.skip('AC-2: 이름 클릭 → 2번차트 (planner dev-confirm 회신 후 구현)', () => {
  // HELD: 이름 셀(doctor-call-name-chart-btn)은 현재 onOpenChart(customer_id,"full")=진료차트 서랍.
  // 요청 "2번차트(고객상세)"로 교체할지(a) 차트번호만 두고 이름은 진료차트 유지(b) planner 확인 후.
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 (HELD — 기준 메뉴/scope 확인): 진료대시보드 행=CheckIn → StatusContextMenu 정합.
//   기존 메뉴 재노출 vs mutation 콜백 배선 scope + §11 확인 후 skip 해제.
// ─────────────────────────────────────────────────────────────────────────────
test.skip('AC-3: 셀 우클릭 → 기존 컨텍스트 메뉴 동일 표시 (planner 기준메뉴 확인 후 구현)', () => {
  // HELD: rows=CheckIn → StatusContextMenu(checkIn 기반, pages/Dashboard.tsx handleCardContext 패턴).
  // 신규 status/flag/room mutation 콜백 배선 = 문원장 진료대시보드 신규 동작 → planner 확인 후.
});
