/**
 * E2E spec — T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1785029897.172259):
 *   "상담·치료사 배정 > 직원별 누적 화면 개편 5항목"
 *   ① 역할 컬럼 제거(데이터 존치, 표시만)
 *   ② 일누적 컬럼 재편 → [일일 배정 목표 / 배정(초진) / 배정(재진) / 토스 / 당김]
 *   ③ 당월누적 컬럼 재편 → [총 누적 배정 / 배정(초진) / 배정(재진) / 토스 / 당김]
 *   ④ 당월누적 = 기준일(오늘, KST) 당월만 강제 집계(전월 자동 제외, 월경계 오프바이원 주의)
 *   ⑤ 배정(초진)/배정(재진)/토스/당김 건수 셀 클릭 → 고객성함+차트번호 리스트 팝업
 *
 * 설계 확정(AC-0 그라운딩):
 *   - 대상: src/pages/Assignments.tsx (③ 직원별 누적 카드).
 *   - 변경5 drill-down = THERAPIST-DESIGNATED(designated-dialog) 패턴 재사용(신규 모달 무분별 신설 금지).
 *     count↔list 단일소스: 셀 표시값 = 명단(AssignDrillItem[]) length 파생(THERAPIST-DESIGNATED AC2 패턴).
 *   - 배정(초진)=assigned(균등, 축≠재진) / 배정(재진)=returning — 기존 '직원별 누적' 집계 정의 그대로(정의 재발명 금지).
 *   - 변경4: [당월누적] 은 선택일과 무관하게 todaySeoulISODate() 당월 경계(1일 00:00 ~ 오늘+1일 00:00 exclusive).
 *   - '일일 배정 목표'(변경2) = 현행 소스 부재(엔진 CRM-ASSIGN-V1 미착수) → dailyTargetOf() 느슨결합 단일지점,
 *     현재 '—'. 엔진 배포 시 이 함수만 교체(컬럼/표시 구조 유지). DB 무변경(db_change=false).
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(형제 foot spec 동형).
 * 실렌더/클릭·날짜 연동 값 검증은 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 컬럼 재편 — 역할 제거 + 일/당월 5지표 재편 (변경1/2/3)
// ─────────────────────────────────────────────────────────────────────────────
test('변경1: 역할 컬럼 헤더/바디에서 제거(표시만, 데이터 존치)', () => {
  const src = read(PAGE);
  // rowSpan 역할 헤더 th 미존재
  expect(src).not.toMatch(/rowSpan=\{2\}>역할<\/th>/);
  // 바디에서 역할 표시 td('상담사'/'치료사' 텍스트) 제거
  expect(src).not.toContain("{st.staff.role === 'consultant' ? '상담사' : '치료사'}");
});

test('변경2: 일누적 그룹 = [일일 배정 목표/배정(초진)/배정(재진)/토스/당김] 5지표', () => {
  const src = read(PAGE);
  // 그룹 헤더는 5컬럼(colSpan=5)
  expect(src).toMatch(/colSpan=\{5\}[\s\S]*?data-testid="accum-group-day"/);
  // 2단 헤더 라벨
  expect(src).toContain('>일일 배정 목표</th>');
  expect(src).toContain('>배정(초진)</th>');
  expect(src).toContain('>배정(재진)</th>');
  // 구 라벨(배정(균등)/재진) 잔존 금지
  expect(src).not.toContain('>배정(균등)</th>');
  expect(src).not.toMatch(/font-medium">재진<\/th>/);
});

test('변경3: 당월누적 그룹 = [총 누적 배정/배정(초진)/배정(재진)/토스/당김] 5지표', () => {
  const src = read(PAGE);
  expect(src).toMatch(/colSpan=\{5\}[\s\S]*?data-testid="accum-group-month"/);
  expect(src).toContain('>총 누적 배정</th>');
  // 당월 총 누적 = 초진 명단 + 재진 명단 length (파생값, 단일소스)
  expect(src).toContain('st.month.assigned.length + st.month.returning.length');
  expect(src).toContain('data-testid={`accum-month-total-${st.staff.id}`}');
  // 빈 상태 colSpan 이 신규 11컬럼(직원1 + 일누적5 + 당월누적5)로 갱신
  expect(src).toMatch(/colSpan=\{11\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 당월 필터 경계 — 기준일(오늘, KST) 당월만 강제(전월 제외) (변경4)
// ─────────────────────────────────────────────────────────────────────────────
test('변경4: 당월누적은 선택일이 아닌 기준일(오늘,KST) 당월 경계로 강제', () => {
  const src = read(PAGE);
  // 당월 경계는 todaySeoulISODate() 기반(선택일 selectedDate 아님)
  expect(src).toContain('const todayIso = todaySeoulISODate();');
  expect(src).toContain(
    "const nowMonthStartMs = new Date(`${todayIso.slice(0, 7)}-01T00:00:00+09:00`).getTime();",
  );
  // 구 구현(선택월 기반 selMonthStartMs)이 당월 경계로 남아있지 않음
  expect(src).not.toContain(
    "const selMonthStartMs = new Date(`${selectedDate.slice(0, 7)}-01T00:00:00+09:00`).getTime();",
  );
});

test('변경4: 월경계 오프바이원 — 상한은 (오늘+1일) 00:00 exclusive (오늘분 포함/익월 배제)', () => {
  const src = read(PAGE);
  expect(src).toContain('const nowMonthEndExclMs = todayStartMs + 24 * 60 * 60 * 1000;');
  expect(src).toContain('const inMonth = (ms: number) => ms >= nowMonthStartMs && ms < nowMonthEndExclMs;');
  // 일누적은 여전히 선택일 당일(독립 구간)
  expect(src).toContain('const inDay = (ms: number) => ms >= selDayStartMs && ms < selDayEndExclMs;');
  // 두 구간 독립 → check_in 은 둘 중 하나라도 걸리면 집계(과거월 선택 시 일누적만 걸리는 케이스 보존)
  expect(src).toContain('if (Number.isNaN(ms) || (!inDay(ms) && !inMonth(ms))) continue;');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 건수 셀 클릭 drill-down — 고객 성함+차트번호 리스트 (변경5)
// ─────────────────────────────────────────────────────────────────────────────
test('변경5: 건수 셀 클릭 → drill-down 다이얼로그(designated 패턴 재사용)', () => {
  const src = read(PAGE);
  // drill 다이얼로그 상태 + 컴포넌트
  expect(src).toContain('const [drillDialog, setDrillDialog]');
  expect(src).toContain('data-testid="accum-drill-title"');
  expect(src).toContain('data-testid="accum-drill-list"');
  expect(src).toContain('data-testid="accum-drill-empty"'); // 0건 빈 상태 안내(에러 아님)
  // 명단 항목 = 성함 + 차트번호(chartNoBadge)
  expect(src).toContain('{chartNoBadge(it.chartNumber)}');
});

test('변경5: 클릭 가능 셀 = 배정(초진)/배정(재진)/토스/당김 (일누적·당월누적 각각)', () => {
  const src = read(PAGE);
  for (const scope of ['day', 'month']) {
    expect(src).toContain(`accum-${scope}-assigned-`);
    expect(src).toContain(`accum-${scope}-returning-`);
    expect(src).toContain(`accum-${scope}-toss-`);
    expect(src).toContain(`accum-${scope}-pull-`);
  }
  // '일일 배정 목표'/'총 누적 배정'은 비클릭(파생/목표 표시)
  expect(src).toContain('data-testid={`accum-day-target-${st.staff.id}`}');
});

test('변경5: count↔list 단일소스 — 셀 표시값 = items.length, 팝업 items 동일 배열', () => {
  const src = read(PAGE);
  // 클릭 셀 표시값이 items.length (별도 카운터 없음)
  expect(src).toContain('{items.length}');
  // 클릭 시 동일 items 배열을 다이얼로그로 전달
  expect(src).toContain('setDrillDialog({ staffName: staffLabel, scopeLabel, metricLabel, items })');
  // StaffCount 지표는 명단 배열(AssignDrillItem[]) — 카운트 정의 재발명 없이 length 파생
  expect(src).toContain('assigned: AssignDrillItem[]');
  expect(src).toContain('returning: AssignDrillItem[]');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (스텝4~9): 변경5 상세화 fqb6 (김주연 총괄, MSG-fqb6/s0d0, 목업 F0BKYPYK8TW)
//   상세① 팝업 리스트 = 일자별 그룹 + 가로 2단(2열)
//   상세② 성함/차트번호 클릭 → 그 고객 2번차트 (THERAPIST-DESIGNATED/ASSIGNHIST 라우팅 재사용)
// ─────────────────────────────────────────────────────────────────────────────
test('상세①(fqb6): AssignDrillItem 에 일자별 그룹 기준 date 필드(서울 YYYY-MM-DD)', () => {
  const src = read(PAGE);
  // 리스트 항목이 date 필드 보유 → 일자별 그룹핑 소스
  expect(src).toMatch(/interface AssignDrillItem[\s\S]*?date: string \| null;/);
  // 배정(초진/재진) date = check_ins.checked_in_at (KST 변환)
  expect(src).toContain('date: ci.checked_in_at ? seoulISODate(ci.checked_in_at) : null,');
  // 토스/당김 date = assignment_actions.created_at (액션 발생일)
  expect(src).toContain('key: a.id, date: seoulISODate(a.created_at)');
});

test('상세①(fqb6): 팝업 리스트 = 일자별 그룹(날짜 헤더) + 가로 2단(2열) grid', () => {
  const src = read(PAGE);
  // 일자 그룹핑 (Map<date, items[]>) + 최신 일자 상단(내림차순 정렬)
  expect(src).toContain('const groups = new Map<string, AssignDrillItem[]>();');
  expect(src).toContain('return b.localeCompare(a);'); // YYYY-MM-DD 내림차순 = 최신 상단
  // 날짜 헤더 (YY-MM-DD 표기 = slice(2))
  expect(src).toContain('data-testid="accum-drill-date-header"');
  expect(src).toMatch(/dkey === '날짜 미상' \? dkey : dkey\.slice\(2\)/);
  // 가로 2단(2열) — grid-cols-2 (홀수면 마지막 행 우측 자동 공백)
  expect(src).toContain('grid grid-cols-2');
  // 항목 testid 는 유지(count↔list 정합 검증 회귀 보호)
  expect(src).toContain('data-testid="accum-drill-item"');
});

test('상세②(fqb6): 성함/차트번호 클릭 → 2번차트 window.open — 신규 라우팅 신설 금지(기존 재사용)', () => {
  const src = read(PAGE);
  // 성함·차트번호 각각 클릭 타깃 노출(둘 다 클릭 가능 — 버블링으로 동일 버튼 onClick)
  expect(src).toContain('data-testid="accum-drill-name"');
  expect(src).toContain('data-testid="accum-drill-chartno"');
  expect(src).toContain('data-testid={`accum-drill-chart-link-${it.key}`}');
  // 2번차트 라우팅 = 기존 ASSIGNHIST-CHARTNO-CHART2-LINK 패턴 재사용(/chart/${customerId}, window.open)
  expect(src).toContain('`${window.location.origin}/chart/${cid}`');
  expect(src).toContain('`foot-chart-${cid}`');
  // customerId 없는 항목(고객 정보 없음)은 링크 비활성(오라우팅 방지)
  expect(src).toContain('{it.customerId ? (');
});

// ─────────────────────────────────────────────────────────────────────────────
// 정합(reconcile) 불변식 — 착수 전 정합 체크리스트 인코딩
// ─────────────────────────────────────────────────────────────────────────────
test('정합: 배정(초진)=assigned/배정(재진)=returning — 기존 집계 정의 재사용(재발명 금지)', () => {
  const src = read(PAGE);
  // T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN SUPERSEDE: 상담(consult) 배정 카운트 소스가
  //   자동 365-recency(monthAxisOf consult) → 실장 수동 선택(assignment_consult_type, assignConsultBucket)로
  //   부분 재분리(대표 확정 스코프). 배정(초진)=assigned/배정(재진)=returning 셀↔버킷 매핑 정의는 불변.
  expect(src).toContain('assignConsultBucket(ci)');
  // 치료(therapy) 축은 재진 개념 무해당 → auto-axis(monthAxisOf) 유지(스코프 밖).
  expect(src).toContain("monthAxisOf(ci, 'therapy') === 'returning'");
  // 토스/당김 = assignment_actions audit 유지
  expect(src).toContain("a.action_type === 'toss' && a.from_staff_id");
  expect(src).toContain("a.action_type === 'pull_in' && a.to_staff_id");
});

test('정합: 일일 배정 목표 값은 dailyTargetOf 단일지점(엔진 CRM-ASSIGN-V1 느슨결합, 현재 —)', () => {
  const src = read(PAGE);
  expect(src).toContain('const dailyTargetOf = useCallback');
  // 현재 소스 부재 → null → 표시 '—'
  expect(src).toMatch(/return null;/);
  expect(src).toContain("dayTarget == null ? '—' : dayTarget.toLocaleString()");
});
