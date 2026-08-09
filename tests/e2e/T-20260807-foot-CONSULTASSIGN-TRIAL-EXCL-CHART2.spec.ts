/**
 * T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2 — 체험단(is_trial) 마커 기준 상담 배정 수 제외 + 2번 차트 [체험단] 분류.
 *
 * 배경(김주연 총괄 confirm 2026-08-07): 실장별 '상담 배정 수'에서 체험단 건을 빼고, 2번 유입경로 차트에는
 *   [체험단] 카테고리를 별도 표시. 구분 기준 = 예약 화면 '체험단' 전용 마커(NULL-inflow 전체 아님, ③ 정정).
 *   적용 시점 = 2026-08-01~ 당월(forward-only, 7월 이전 누적 무변경).
 *
 * DA CONSULT-REPLY (SSOT: agents/docs/da_replies/da_decision_foot_is_trial_marker_schema_20260807.md):
 *   Q1 GO(ADDITIVE) reservations.is_trial NOT NULL DEFAULT false · Q2(a) 단일 canonical on reservations + 파생 join.
 *   §36 방화벽: canonical inflow_channel 11코드/referral_source 무접촉 = is_trial 은 직교 4번째 독립 boolean 마커.
 *
 * 검증 계약(순수 결정함수 — DB/auth/webServer 불요, unit 프로젝트):
 *   본 티켓의 핵심은 write 스키마가 아니라 두 소비자의 파생 결정 규칙이다.
 *   - Stream A (상담 배정 수 제외 · Assignments.tsx): VG3 = LEFT JOIN 등가.
 *       reservation_id 존재 + 그 예약 is_trial=true + 배정일 >= 8/1 만 제외.
 *       ★walk-in(reservation_id NULL)은 절대 drop 금지(INNER JOIN 함정) → 정상 count 생존.
 *       ★pre-8/1(forward-only)은 is_trial=true 여도 제외 미적용(7월 누적 불변).
 *   - Stream B (2번 차트 [체험단] · VisitRouteSection.tsx): is_trial=true → [체험단] 버킷,
 *       아니면 방문경로(NULL/빈값 → 미입력). 1행 1버킷(총건수 정합 유지).
 *   - VG1 (§36 방화벽): 마이그 SQL 이 inflow_channel/referral_source/visit_route 축 무접촉(정적 소스 가드).
 *
 * 실 UI(예약 팝업 체험단 체크박스) + 실 데이터 경로(is_trial write→집계 제외)의 라이브 관측은
 *   컬럼 prod 적용(supervisor DB-GATE GO-token) 이후 supervisor 갤탭 field-soak/browser_verify 로 확정.
 *   본 spec 은 적용 전에도 결정론으로 그린인 파생 규칙 계약을 잠근다(FORMSTATE 형제 spec 의 합성-검증 관례 계승).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── 구현 미러: Assignments.tsx TRIAL_EXCL_FROM_ISO + isTrialAssign 결정 규칙 ──────────
const TRIAL_EXCL_FROM_ISO = '2026-08-01';

type Assign = {
  consultant_id: string | null;
  reservation_id: string | null;
  ciDateIso: string | null; // seoulISODate(checked_in_at)
};

/** Stream A: 그 배정이 '상담 배정 수'에 count 되는가(true=count, false=제외). */
function isCounted(ci: Assign, trialMap: Map<string, boolean>): boolean {
  if (!ci.consultant_id) return false; // 배정 자체 없음
  const isTrialAssign =
    !!ci.reservation_id &&
    trialMap.get(ci.reservation_id) === true &&
    ci.ciDateIso != null &&
    ci.ciDateIso >= TRIAL_EXCL_FROM_ISO;
  return !isTrialAssign;
}

// ── 구현 미러: VisitRouteSection.tsx bucketOf ─────────────────────────────────────────
const UNSET_LABEL = '미입력';
const TRIAL_LABEL = '[체험단]';
function bucketOf(r: { is_trial?: boolean | null; visit_route?: string | null }): string {
  return r.is_trial === true ? TRIAL_LABEL : ((r.visit_route ?? '').trim() || UNSET_LABEL);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 시나리오 1 (Stream A · VG3): 체험단 배정 제외 + walk-in 생존 + forward-only
// ═══════════════════════════════════════════════════════════════════════════════════
test('시나리오1: 상담 배정 수 — 체험단(is_trial) 배정만 제외, walk-in·pre-8/1·비체험단은 count 생존', () => {
  const trialMap = new Map<string, boolean>([
    ['R-TRIAL', true], // 체험단 예약
    ['R-NORMAL', false], // 일반 예약(명시 false)
  ]);

  // (a) 체험단 예약 + 8월 배정 → 제외
  expect(isCounted({ consultant_id: 'S1', reservation_id: 'R-TRIAL', ciDateIso: '2026-08-05' }, trialMap)).toBe(false);

  // (b) ★walk-in(reservation_id NULL) → 맵 미포함 = 비-trial 정상 count (INNER JOIN drop 금지)
  expect(isCounted({ consultant_id: 'S1', reservation_id: null, ciDateIso: '2026-08-05' }, trialMap)).toBe(true);

  // (c) ★forward-only: 체험단 예약이라도 pre-8/1 배정은 제외 미적용(7월 누적 불변)
  expect(isCounted({ consultant_id: 'S1', reservation_id: 'R-TRIAL', ciDateIso: '2026-07-31' }, trialMap)).toBe(true);

  // (d) 일반 예약(is_trial=false) 8월 배정 → count
  expect(isCounted({ consultant_id: 'S1', reservation_id: 'R-NORMAL', ciDateIso: '2026-08-05' }, trialMap)).toBe(true);

  // (e) 맵에 없는 reservation_id(컬럼 미반영 DB 폴백 등) → 비-trial 로 간주 = count (과소집계 방지)
  expect(isCounted({ consultant_id: 'S1', reservation_id: 'R-UNKNOWN', ciDateIso: '2026-08-05' }, trialMap)).toBe(true);

  // (f) consultant 미배정 → 애초에 count 안 됨
  expect(isCounted({ consultant_id: null, reservation_id: 'R-NORMAL', ciDateIso: '2026-08-05' }, trialMap)).toBe(false);

  // 집계 정합: 위 배정 세트에서 count 되는 건수 = (b)(c)(d)(e) = 4
  const set: Assign[] = [
    { consultant_id: 'S1', reservation_id: 'R-TRIAL', ciDateIso: '2026-08-05' }, // 제외
    { consultant_id: 'S1', reservation_id: null, ciDateIso: '2026-08-05' }, // count
    { consultant_id: 'S1', reservation_id: 'R-TRIAL', ciDateIso: '2026-07-31' }, // count(pre-8/1)
    { consultant_id: 'S1', reservation_id: 'R-NORMAL', ciDateIso: '2026-08-05' }, // count
    { consultant_id: 'S1', reservation_id: 'R-UNKNOWN', ciDateIso: '2026-08-05' }, // count
    { consultant_id: null, reservation_id: 'R-NORMAL', ciDateIso: '2026-08-05' }, // 배정없음
  ];
  expect(set.filter((c) => isCounted(c, trialMap)).length).toBe(4);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 시나리오 2 (Stream B): 2번 차트 [체험단] 버킷 분류 + 1행 1버킷(총건수 정합)
// ═══════════════════════════════════════════════════════════════════════════════════
test('시나리오2: 2번 유입경로 차트 — is_trial=true 는 [체험단] 버킷, 그 외 방문경로/미입력 (1행 1버킷)', () => {
  expect(bucketOf({ is_trial: true, visit_route: 'naver' })).toBe(TRIAL_LABEL); // 체험단은 방문경로보다 우선
  expect(bucketOf({ is_trial: true, visit_route: null })).toBe(TRIAL_LABEL);
  expect(bucketOf({ is_trial: false, visit_route: '지인소개' })).toBe('지인소개');
  expect(bucketOf({ is_trial: null, visit_route: '간판' })).toBe('간판');
  expect(bucketOf({ is_trial: false, visit_route: '' })).toBe(UNSET_LABEL);
  expect(bucketOf({ is_trial: null, visit_route: '   ' })).toBe(UNSET_LABEL); // 공백 trim → 미입력
  expect(bucketOf({})).toBe(UNSET_LABEL);

  // 총건수 정합: N행 → 합계 = N (1행 1버킷, 이중계수 없음)
  const rows = [
    { is_trial: true, visit_route: 'naver' },
    { is_trial: true, visit_route: null },
    { is_trial: false, visit_route: '지인소개' },
    { is_trial: false, visit_route: '지인소개' },
    { is_trial: false, visit_route: '' },
  ];
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(bucketOf(r), (counts.get(bucketOf(r)) ?? 0) + 1);
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  expect(total).toBe(rows.length);
  expect(counts.get(TRIAL_LABEL)).toBe(2);
  expect(counts.get('지인소개')).toBe(2);
  expect(counts.get(UNSET_LABEL)).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 시나리오 3 (VG1 · §36 방화벽): 마이그 SQL 이 유입/방문경로 축 무접촉 (정적 소스 가드)
// ═══════════════════════════════════════════════════════════════════════════════════
test('시나리오3: 마이그 SQL — is_trial 독립 컬럼 ADD 만, §36 유입/방문경로 축 무접촉 + 롤백 대칭', () => {
  const migDir = path.join(REPO_ROOT, 'supabase', 'migrations');
  const upPath = path.join(migDir, '20260807180000_foot_reservations_is_trial_marker.sql');
  const rbPath = path.join(migDir, '20260807180000_foot_reservations_is_trial_marker.rollback.sql');
  const up = fs.readFileSync(upPath, 'utf8');
  const rb = fs.readFileSync(rbPath, 'utf8');

  // ADD: metadata-only fast-ADD (NOT NULL DEFAULT false)
  expect(up).toMatch(/ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false/);

  // §36 방화벽: 유입/방문경로 축을 ALTER/write 하지 않음(주석 언급은 허용하되 DDL 문에서 미조작).
  //   ALTER ... inflow_channel / referral_source / visit_route 같은 축 변경 DDL 이 없어야 한다.
  expect(up).not.toMatch(/ALTER\s+TABLE[^;]*inflow_channel/i);
  expect(up).not.toMatch(/ALTER\s+TABLE[^;]*referral_source/i);
  expect(up).not.toMatch(/ALTER\s+TABLE[^;]*visit_route/i);
  // enum/CHECK 확장(폐쇄 11코드 도메인 위반) 없음
  expect(up).not.toMatch(/ADD\s+CONSTRAINT[^;]*inflow/i);

  // 파괴 0: 기존 컬럼 DROP/타입변경 없음(up 에는 DROP 문 부재)
  expect(up).not.toMatch(/DROP\s+COLUMN/i);

  // 롤백 대칭: DROP COLUMN IF EXISTS is_trial 단 하나(추가한 컬럼만 역).
  expect(rb).toMatch(/DROP COLUMN IF EXISTS is_trial/);
  expect(rb).not.toMatch(/inflow_channel|referral_source|visit_route/);
});
