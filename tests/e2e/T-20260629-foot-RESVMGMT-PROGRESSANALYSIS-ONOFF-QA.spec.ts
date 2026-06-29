import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260629-foot-RESVMGMT-PROGRESSANALYSIS-ONOFF-QA — 예약관리 경과분석 ON/OFF 동작 QA 검증
 * 원천: 김주연 총괄(C0ATE5P6JTH, thread 1782717506.867559). MSG-20260629-162544-4irc.
 *
 * 성격: 읽기전용 동작 검증 티켓 (db_change=false, 코드 변경 없음).
 *   기존 구현(T-PROGRESS-CHECKPOINT AC-2/3/4, T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK,
 *   T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND, T-20260615-foot-RESVMGMT-REFIX-8)이
 *   현장 명시 4개 검증항목을 충족하는지를 source-integrity gating 으로 회귀 차단한다.
 *
 *   거대-인라인 established 컴포넌트(Reservations.tsx) 관례 = 소스 정적 단언으로 가드.
 *   실 브라우저 동작(토글 클릭 → 목록 필터 변화)은 supervisor field-soak 로 최종 확정.
 *
 * 검증항목(현장 명시):
 *   1. 경과분석 ON  → 체크포인트 회차 마킹된 예약만 표시 (비마킹 미표시)
 *   2. 경과분석 OFF → 전체 예약 표시
 *   3. 예약 저장 시 체크포인트 해당 여부 자동 마킹
 *   4. 일간 보기·주간 보기 양쪽에 동일 필터 적용
 *
 * ⚠ 본 QA는 '예약관리' 화면 한정. 연관 티켓 T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE
 *   (진료관리 탭의 경과분석 플랜 물리적 위치 이동, 의료화면 confirm 대기)은 별개 작업 — 비중첩.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 검증항목 4 (선행) — 단일 필터 상태(filterProgress)가 ON/OFF 토글의 SSOT
// ═══════════════════════════════════════════════════════════════════════════
test.describe('검증항목: 경과분석 토글 = 단일 상태 SSOT', () => {
  test('AC0-1: filterProgress 상태가 useState(false)로 OFF 기본값', () => {
    expect(RESV_PAGE, '경과분석 필터 상태(filterProgress) 미정의 — 기본 OFF여야 함')
      .toContain('const [filterProgress, setFilterProgress] = useState(false)');
  });

  test('AC0-2: 토글 버튼(progress-filter-btn)이 filterProgress 를 반전', () => {
    expect(RESV_PAGE, '경과분석 토글 버튼 testid 누락').toContain('data-testid="progress-filter-btn"');
    expect(RESV_PAGE, '토글 onClick 이 filterProgress 반전이 아님')
      .toContain('onClick={() => setFilterProgress(f => !f)}');
  });

  test('AC0-3: ON 상태 시각 표시(라벨 + ON 뱃지)', () => {
    expect(RESV_PAGE, '경과분석 버튼 라벨 누락').toContain('경과분석');
    expect(RESV_PAGE, 'ON 상태 표시(뱃지) 누락')
      .toContain("{filterProgress && <span className=\"ml-0.5 opacity-70\">ON</span>}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 검증항목 1 + 2 + 4 — 일간 보기: ON=마킹만 / OFF=전체
// ═══════════════════════════════════════════════════════════════════════════
test.describe('검증항목1·2·4(일간): ON→마킹만 / OFF→전체', () => {
  test('AC1-1: 일간 보기(viewMode===day)에서 ON 시 progress_check_required 만 통과', () => {
    // !filterProgress || r.progress_check_required
    //   OFF → 좌변 true → 전체 통과(검증항목2)
    //   ON  → 우변만 → progress_check_required=true 만 통과(검증항목1)
    expect(RESV_PAGE, '일간 보기 경과분석 필터식 누락/변경')
      .toContain('.filter((r) => !filterProgress || r.progress_check_required)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 검증항목 1 + 2 + 4 — 주간 보기: ON=마킹만 / OFF=전체
// ═══════════════════════════════════════════════════════════════════════════
test.describe('검증항목1·2·4(주간): ON→마킹만 / OFF→전체', () => {
  test('AC2-1: 주간 보기(table 슬롯 셀)에서 ON 시 progress_check_required 만 통과', () => {
    // filterProgress ? list.filter(r => r.progress_check_required) : list
    //   ON  → 마킹만(검증항목1) / OFF → list 전체(검증항목2)
    expect(RESV_PAGE, '주간 보기 경과분석 필터식 누락/변경')
      .toContain('(filterProgress ? list.filter(r => r.progress_check_required) : list)');
  });

  test('AC2-2: 일간·주간이 동일 filterProgress 단일 상태를 공유(검증항목4 일관성)', () => {
    // 두 보기 경로 모두 동일한 상태 변수에 의존 → 토글 1회로 양쪽 동시 반영.
    const dayUse = RESV_PAGE.includes('!filterProgress || r.progress_check_required');
    const weekUse = RESV_PAGE.includes('filterProgress ? list.filter(r => r.progress_check_required) : list');
    expect(dayUse && weekUse, '일간/주간 중 한쪽이 filterProgress 필터를 적용하지 않음(보기별 불일치)')
      .toBe(true);
    // 별도 주간 전용 필터 상태가 존재하지 않음 — 상태는 filterProgress 하나뿐(SSOT 가드).
    expect(RESV_PAGE, '주간 전용 별도 경과분석 상태가 생겨 일관성이 깨짐')
      .not.toContain('filterProgressWeek');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 검증항목 3 — 예약 저장 시 체크포인트 해당 여부 자동 마킹
// ═══════════════════════════════════════════════════════════════════════════
test.describe('검증항목3: 저장 시 자동 마킹', () => {
  test('AC3-1: 경과분석 플랜 자동 감지 — 회차 tier × milestone × is_active 매칭', () => {
    // 패키지 연결 + 다음 회차(used_sessions+1)가 플랜 milestone 에 도달하면 progressCheckPlan 발동.
    expect(RESV_PAGE, '다음 회차 산식(used_sessions+1) 누락')
      .toContain('selectedLinkedPkg.used_sessions + 1');
    expect(RESV_PAGE, '플랜 매칭 조건(tier=total_sessions) 누락')
      .toContain('p.session_count_tier === selectedLinkedPkg.total_sessions');
    expect(RESV_PAGE, '플랜 매칭 조건(milestone=anticipatedSession) 누락')
      .toContain('p.session_milestone === anticipatedSession');
    // total_sessions=0(체험 등)은 경과분석 제외 가드 — 오마킹 방지.
    expect(RESV_PAGE, 'total_sessions>0 제외 가드 누락(체험 오마킹 위험)')
      .toContain('selectedLinkedPkg.total_sessions > 0');
  });

  test('AC3-2: 저장 페이로드에 progressCheck(required/label) 자동 산출 후 전달', () => {
    // 패키지 미연결이면 null, 연결이면 플랜 감지결과 그대로.
    expect(RESV_PAGE, '저장 시 progressCheck 자동 산출 누락')
      .toContain('{ required: !!progressCheckPlan, label: progressCheckPlan?.label ?? null }');
    expect(RESV_PAGE, 'createReservationCanonical 로 progressCheck 전달 누락')
      .toContain('progressCheck,');
  });

  test('AC3-3: canonical 생성 경로가 progress_check_required/label 를 DB에 영속', () => {
    // 자동 마킹의 종착 — reservations row 에 컬럼 기록(연결 예약 한정).
    expect(RESV_PAGE, '저장 페이로드 progress_check_required 영속 누락')
      .toContain('progress_check_required: input.progressCheck?.required ?? false');
    expect(RESV_PAGE, '저장 페이로드 progress_check_label 영속 누락')
      .toContain('progress_check_label: input.progressCheck?.label ?? null');
  });

  test('AC3-4: 자동 마킹된 예약은 경과분석 배지 노출 — ON 필터 노출과 일관', () => {
    // 저장 후 progress_check_required=true → 배지 + ON 필터에서 노출(검증항목3 후속 확인).
    expect(RESV_PAGE, '경과분석 배지(progress-badge) 노출 가드 누락')
      .toContain('r.progress_check_required && (');
    expect(RESV_PAGE, '경과분석 배지 testid 누락').toContain('progress-badge-${r.id}');
  });
});
