/**
 * E2E spec — T-20260617-foot-DOCTABLE-VISITTYPE-UNIFY (P2)
 * 의사 환자 테이블뷰 전체 — 초/재 배지 통일 (DoctorPatientList + 전수 스캔).
 *
 * reporter(문지은 대표원장, #foot, thread 1781575985.053909): "모두 통일. 의사가 보는
 * 환자 테이블뷰는 반드시 통일해줘 반드시반드시" → A안(통일) 확정 + 의사 시야 전 화면 통일로 scope 확장.
 *
 * 미러 기준: 진료 알림판(DoctorCallDashboard VisitBadge, commit 42a9e409/cfb241d4) — 초/재 단일글자 라벨 +
 *   [배지+이름] 좌정렬. 본 ticket은 동일 패턴을 미통일 화면(DoctorPatientList 처방 환자 목록 탭)에 확산.
 *
 * 전수 스캔 결과(AC2): 의사 환자 테이블뷰 중 초진/재진 풀텍스트 잔존 = DoctorPatientList 단 1곳.
 *   - DoctorCallDashboard: 이미 초/재(미러 기준) → 무변경.
 *   - DoctorTreatmentPanel: 단일환자 진료 입력 패널(테이블뷰 아님), 안내문구 부착 설명 배지 → scope 외, 무변경.
 *   - KohReportTab(균검사지): 초진/재진 문자열 0건 → 무변경.
 *   - SalesPatientTab/CustomerHoverCard/NewCheckInDialog/Dashboard/SelfCheckIn: 의사 테이블뷰 아님 → scope 외.
 *
 * 컴포넌트가 auth/DB에 의존하므로 렌더 정본(.tsx)을 직접 읽어 정적 검증(미러 spec과 동일 방식).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const DOC_DIR = resolve(__dirname_, '../../src/components/doctor');
const listSrc = readFileSync(resolve(DOC_DIR, 'DoctorPatientList.tsx'), 'utf-8');
const dashSrc = readFileSync(resolve(DOC_DIR, 'DoctorCallDashboard.tsx'), 'utf-8');
const panelSrc = readFileSync(resolve(DOC_DIR, 'DoctorTreatmentPanel.tsx'), 'utf-8');
const kohSrc = readFileSync(resolve(DOC_DIR, 'KohReportTab.tsx'), 'utf-8');

test.describe('DOCTABLE-VISITTYPE-UNIFY — 시나리오1: 처방 환자 목록 탭 배지 축약', () => {
  test('AC1: VisitTypeBadge 표시 라벨이 초/재(단일글자) — 풀텍스트 라벨 0건', () => {
    expect(listSrc).toContain("new: { label: '초', cls: 'bg-blue-100 text-blue-700' }");
    expect(listSrc).toContain("returning: { label: '재', cls: 'bg-emerald-100 text-emerald-700' }");
    // 표시 라벨로 풀텍스트(초진/재진) 재유입 회귀 차단
    expect(listSrc).not.toContain("label: '초진'");
    expect(listSrc).not.toContain("label: '재진'");
  });

  test('AC1: 배지 left-edge 세로 일치 — 배지 grid 칼럼(③) flex justify-start, 이름(④) 바로 왼쪽', () => {
    // 배지는 독립 grid 칼럼에서 justify-start로 셀 좌측 앵커 → 모든 행 동일 x위치(이름 길이 무관).
    expect(listSrc).toMatch(/<div className="flex justify-start">\s*<VisitTypeBadge type=\{row\.visit_type\} \/>/);
    // 이름 셀은 배지 칼럼 바로 오른쪽에서 좌정렬(text-left)
    expect(listSrc).toMatch(/text-left[\s\S]*?data-testid="patient-name"/);
  });
});

test.describe('DOCTABLE-VISITTYPE-UNIFY — 시나리오2: 진료 알림판과 일관성', () => {
  test('AC2: DoctorCallDashboard(미러 기준)와 동일한 초/재 단일글자 + 색상 토큰', () => {
    // 미러 기준은 그대로 초/재 유지(무변경 확인)
    expect(dashSrc).toContain("new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' }");
    expect(dashSrc).toContain("returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' }");
    // 처방 목록과 미러의 색상 토큰 동일(초=blue, 재=emerald)
    expect(listSrc).toContain("cls: 'bg-blue-100 text-blue-700'");
    expect(listSrc).toContain("cls: 'bg-emerald-100 text-emerald-700'");
  });

  test('AC2 전수 스캔: 의사 환자 테이블뷰에 초진/재진 풀텍스트 배지 라벨 잔존 0건', () => {
    // DoctorPatientList: 풀텍스트 라벨 제거 확인
    expect(listSrc).not.toMatch(/label: '초진'|label: '재진'/);
    // DoctorCallDashboard: 표시 라벨은 단일글자(풀텍스트는 full=hover 풀이로만 허용)
    expect(dashSrc).not.toMatch(/label: '초진'|label: '재진'/);
  });
});

test.describe('DOCTABLE-VISITTYPE-UNIFY — 시나리오3: 회귀 가드 (변경 없어야 함)', () => {
  test('AC3: 배지 배경색(cls) 불변 — 초=blue, 재=emerald', () => {
    expect(listSrc).toContain("new: { label: '초', cls: 'bg-blue-100 text-blue-700' }");
    expect(listSrc).toContain("returning: { label: '재', cls: 'bg-emerald-100 text-emerald-700' }");
  });

  test('AC3: 칼럼폭/폰트(className)·data-testid 불변', () => {
    expect(listSrc).toContain(
      'inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-center',
    );
    expect(listSrc).toContain('data-testid="visit-type-badge"');
    // 이름 클릭→차트 이동 동선(onOpenChart) 보존
    expect(listSrc).toContain('onOpenChart');
  });

  test('AC3: scope 외 화면 무변경 — 진료 패널 설명 배지/안내문구 + 균검사지', () => {
    // DoctorTreatmentPanel은 단일환자 진료 입력 패널(테이블뷰 아님) — 풀텍스트 라벨 + 안내문구 보존
    expect(panelSrc).toContain("new: '초진'");
    expect(panelSrc).toContain("returning: '재진'");
    expect(panelSrc).toContain('예진차트 확인 필요');
    // KohReportTab(균검사지)에는 초진/재진 배지 자체가 없음(무변경 확인)
    expect(kohSrc).not.toMatch(/초진|재진/);
  });
});
