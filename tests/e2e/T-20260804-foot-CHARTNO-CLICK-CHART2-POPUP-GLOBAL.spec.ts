/**
 * E2E spec — T-20260804-foot-CHARTNO-CLICK-CHART2-POPUP-GLOBAL (P2/foot · ADDITIVE · db_change=false)
 *
 * 현장 요청(planner NEW-TASK MSG-20260804-081336-wes1):
 *   풋센터 CRM 전 화면에서 [차트번호] 클릭 → 2번차트(환자 차트 상세)를 별도 팝업으로 확장.
 *   기준(SSOT) = 일마감>결제내역 차트번호 클릭 팝업(旣배포 T-20260717-foot-CLOSING-CHARTNUM-POPUP).
 *   → 동일 UX(차트번호 자체를 2번차트 진입점화, hover 강조)를 차트번호가 노출되는 모든 화면으로 횡전개.
 *
 * 구현 핵심(수렴):
 *   화면별 개별 window.open 을 복제하지 않고, 차트 접근 단일 게이트웨이(LOGIC-LOCK L-004 = useChart().openChart)
 *   를 소비하는 공통 훅 `useChartNoPopup()` 으로 수렴한다. openChart 는 이미 (a) 사용자 제스처 안에서
 *   window.open('/chart/:id') 별도 팝업창, (b) 팝업차단/자동화(navigator.webdriver) 시 in-page 서랍
 *   (CustomerChartSheet) graceful fallback 을 처리한다(baseline Closing 과 동일 UX + 안전망).
 *   AC-3(전파 충돌 방지): 훅이 e.stopPropagation() → 부모 행/카드/드래그 onClick 과 충돌하지 않는다.
 *   AC(오환자 방지): customerId(customers PK) 정확 바인딩 + customerId 없으면 링크 비활성(no-op).
 *
 * 검증 방식(형제 CHARTNO-CHART2-LINK spec 동형 = TREATTABLE/ASSIGNHIST-CHARTNO-CHART2-LINK):
 *   정본 소스 정적 단언(데이터/로그인 비의존). 공통 훅 계약 + 각 화면 배선을 소스에서 단언한다.
 *   실렌더(차트번호 클릭 → 2번차트 팝업 표출/오환자 없음/행선택 무충돌)는
 *   supervisor 맥스튜디오 실브라우저(갤탭) 단계 보강.
 *
 * 시나리오(티켓 현장 클릭 시나리오 1~5 변환):
 *   S1 공통훅: window.open 복제 없이 useChart().openChart 단일 게이트 재사용 + stopPropagation.
 *   S2 고객관리(고객목록): 차트번호 셀 클릭 활성(c.id) — 행 선택동선과 분리.
 *   S3 예약관리: 예약 카드/클립보드 차트번호 클릭 활성(r.customer_id).
 *   S4 대시보드(대기카드): 차트번호 클릭 활성(checkIn.customer_id) — 카드 상세/드래그와 분리.
 *   S5 매출집계(환자별)·기타(일일기록·EDI·패키지·업무배정) 횡전개 + baseline(일마감) 무회귀.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const HOOK = 'src/hooks/useChartNoPopup.ts';
const CUSTOMERS = 'src/pages/Customers.tsx';
const RESERVATIONS = 'src/pages/Reservations.tsx';
const DASHBOARD = 'src/pages/Dashboard.tsx';
const SALES_PATIENT = 'src/components/sales/SalesPatientTab.tsx';
const DAILY_HISTORY = 'src/pages/DailyHistory.tsx';
const EDI = 'src/pages/EdiExport.tsx';
const PACKAGES = 'src/pages/Packages.tsx';
const ASSIGNMENTS = 'src/pages/Assignments.tsx';
const CLOSING = 'src/pages/Closing.tsx';

// 공통 훅을 소비(import + 호출)하는 전 화면 — 횡전개 대상.
const CONSUMERS = [
  CUSTOMERS,
  RESERVATIONS,
  DASHBOARD,
  SALES_PATIENT,
  DAILY_HISTORY,
  EDI,
  PACKAGES,
  ASSIGNMENTS,
];

// ─────────────────────────────────────────────────────────────────────────────
// S1 (공통훅 계약): 단일 게이트웨이 재사용 + 전파 충돌 방지 + 비활성 no-op.
// ─────────────────────────────────────────────────────────────────────────────
test('S1: 공통 훅 useChartNoPopup 은 useChart().openChart 단일 게이트 재사용(window.open 복제 금지)', () => {
  const src = read(HOOK);
  // 차트 접근 단일 경로(L-004) 소비 — 새 window.open 복제 아님
  expect(src).toMatch(/from '@\/lib\/chartContext'/);
  expect(src).toMatch(/const \{ openChart \} = useChart\(\)/);
  expect(src).toMatch(/openChart\(customerId\)/);
  // 게이트웨이 우회 복제 방지: 훅 "코드"에서 window.open 직접 호출 없음.
  //   (JSDoc 주석의 설명용 'window.open(별도 팝업창)' 언급은 제외 — 주석 라인 스트립 후 검사)
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 블록 주석 제거
    .replace(/^\s*\/\/.*$/gm, ''); // 라인 주석 제거
  expect(codeOnly).not.toMatch(/window\.open\(/);
});

test('S1: 공통 훅은 stopPropagation(AC-3 전파 충돌 방지) + customerId 없으면 no-op', () => {
  const src = read(HOOK);
  // 부모 행/카드/드래그 onClick 버블링 차단
  expect(src).toMatch(/e\?\.stopPropagation\(\)/);
  // customerId 결손(미등록/미발번 등) → 비활성 no-op
  expect(src).toMatch(/if \(!customerId\) return/);
  // 공통 활성 클래스(hover 강조 + 포인터) export
  expect(src).toMatch(/export const CHARTNO_LINK_CLASS =/);
  expect(src).toMatch(/cursor-pointer/);
  expect(src).toMatch(/hover:underline/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 공통: 전 화면이 공통 훅을 import + 호출(개별 핸들러 중복 금지 = 수렴 단언).
// ─────────────────────────────────────────────────────────────────────────────
test('공통: 횡전개 대상 전 화면이 useChartNoPopup + CHARTNO_LINK_CLASS 를 import 하고 호출', () => {
  for (const p of CONSUMERS) {
    const src = read(p);
    expect(src, `${p} 는 공통 훅을 import 해야 함`).toMatch(
      /import \{[^}]*useChartNoPopup[^}]*CHARTNO_LINK_CLASS[^}]*\} from '@\/hooks\/useChartNoPopup'/,
    );
    expect(src, `${p} 는 openChartNo 훅을 호출해야 함`).toMatch(/useChartNoPopup\(\)/);
    // 차트번호 onClick 이 훅으로 배선(customerId 전달 + 이벤트 e 전달=stopPropagation 경로)
    expect(src, `${p} 는 차트번호 onClick → openChartNo(customerId, e) 배선`).toMatch(
      /onClick=\{[^}]*openChartNo\([^,]+,\s*e\)/,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 (고객관리): 차트번호 셀 = c.id 있을 때만 활성 + 행 선택동선과 분리(stopPropagation).
// ─────────────────────────────────────────────────────────────────────────────
test('S2: 고객목록 차트번호 셀(cust-chart-number) 클릭 → openChartNo(c.id) 활성', () => {
  const src = read(CUSTOMERS);
  expect(src).toMatch(/data-testid="cust-chart-number"/);
  // c.id 있을 때만 활성 클래스 + 클릭 배선(오환자 방지 = customers PK)
  expect(src).toMatch(/onClick=\{c\.id \? \(e\) => openChartNo\(c\.id, e\)/);
  expect(src).toMatch(/c\.id \? ' ' \+ CHARTNO_LINK_CLASS/);
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 (예약관리): 예약 클립보드/취소카드 차트번호 = r.customer_id 바인딩.
// ─────────────────────────────────────────────────────────────────────────────
test('S3: 예약관리 차트번호 클릭 → openChartNo(customer_id) 배선', () => {
  const src = read(RESERVATIONS);
  // 클립보드 배지 + 취소카드 배지 두 지점(customer_id / clipboard.resv.customer_id)
  expect(src).toMatch(/openChartNo\(clipboard\.resv\.customer_id, e\)/);
  expect(src).toMatch(/openChartNo\(r\.customer_id, e\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 (대시보드 대기카드): checkIn.customer_id 바인딩 + 카드 상세/드래그와 분리.
// ─────────────────────────────────────────────────────────────────────────────
test('S4: 대시보드 대기카드 차트번호(waiting-card-chartno) 클릭 → openChartNo(checkIn.customer_id)', () => {
  const src = read(DASHBOARD);
  expect(src).toMatch(/data-testid="waiting-card-chartno"/);
  expect(src).toMatch(/onClick=\{checkIn\.customer_id \? \(e\) => openChartNo\(checkIn\.customer_id, e\)/);
  // 카드 body onClick(상세)·dnd 는 그대로 유지(회귀 없음) — 차트번호는 stopPropagation 으로 분리
  expect(src).toMatch(/data-testid="checkin-card"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 (매출집계 환자별 + 기타 화면 + baseline 무회귀).
// ─────────────────────────────────────────────────────────────────────────────
test('S5: 매출집계(환자별) 차트번호 셀·상세모달 → openChartNo(row.customer_id) 배선', () => {
  const src = read(SALES_PATIENT);
  expect(src).toMatch(/onClick=\{row\.customer_id \? \(e\) => openChartNo\(row\.customer_id, e\)/);
});

test('S5: 일일기록·EDI·패키지·업무배정 차트번호 → openChartNo(customerId) 배선', () => {
  // 일일기록: 표 행(r.customer_id) + 취소목록(ci.customer_id)
  const dh = read(DAILY_HISTORY);
  expect(dh).toMatch(/openChartNo\(r\.customer_id, e\)/);
  expect(dh).toMatch(/openChartNo\(ci\.customer_id, e\)/);
  // EDI 내보내기 목록(r.customer_id)
  expect(read(EDI)).toMatch(/openChartNo\(r\.customer_id, e\)/);
  // 패키지 상세(pkg.customer_id)
  expect(read(PACKAGES)).toMatch(/openChartNo\(pkg\.customer_id, e\)/);
  // 업무배정 금일 배분 이력(r.customerId)
  expect(read(ASSIGNMENTS)).toMatch(/openChartNo\(r\.customerId, e\)/);
});

test('S5(무회귀): baseline 일마감>결제내역(closing-chartno-cell) window.open 팝업 동선 불변', () => {
  const src = read(CLOSING);
  // 旣배포 SSOT 는 그대로(별도 window.open — 훅 도입으로 인한 변경 없음)
  expect(src).toMatch(/data-testid="closing-chartno-cell"/);
  expect(src).toMatch(/window\.open\(\s*`\$\{window\.location\.origin\}\/chart\/\$\{r\.row_customer_id\}`/);
  // baseline 은 공통 훅을 도입하지 않음(회귀면=0 유지)
  expect(src).not.toMatch(/useChartNoPopup/);
});

test('S5(무회귀): 이미 클릭 가능하던 진입점(업무배정 성함 window.open, 대시보드 칸반 행 onNameOpen) 불변', () => {
  const asg = read(ASSIGNMENTS);
  // 성함 클릭 = 기존 window.open 유지(차트번호 배지 추가로 대체/삭제되지 않음)
  expect(asg).toMatch(/window\.open\(/);
  // 대시보드 칸반 accordion 행은 기존 onNameOpen(행 클릭 → 차트) 유지
  const dash = read(DASHBOARD);
  expect(dash).toMatch(/onNameOpen!\(item\.customerId, item\.name\)/);
});
