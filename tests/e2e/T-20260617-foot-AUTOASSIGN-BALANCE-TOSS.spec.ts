/**
 * T-20260617-foot-AUTOASSIGN-BALANCE-TOSS — 상담/치료 자동배정·균등분배·토스·당김·통합뷰
 *
 * 현장 확정(o2k7 17:13 최종 doc) + DA CONSULT-REPLY GO(dfd8):
 *   #1 customers.assigned_consultant_id(담당 실장 FK)  #2 assignment_actions(audit SSOT)
 *   #3 재진=visit_type='returning'(enum 신설 금지)     #4 치료유형=package_sessions.session_type 재사용
 *   #6 배정 결과=check_ins.consultant_id/therapist_id   (#5 ad-hoc 출근=deferred sub-task)
 *
 * 7개 현장 클릭 시나리오의 불변식을 정적 소스 검증한다(라이브 env 비의존, 레포 dominant 패턴).
 *   S1 상담사 자동배정(신규·균등)  S2 재진(담당실장·균등제외·카운트)  S3 치료사 자동배정(지정 우선)
 *   S4 토스(사유 필수·넘긴 사람 +1)  S5 당김(상담대기10분+/미배정·cascade 없음)  S6 통합뷰  S7(ad-hoc=deferred)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ENGINE = read('src/lib/autoAssign.ts');
const ENGINE_CODE = stripComments(ENGINE);
const PAGE = read('src/pages/Assignments.tsx');
const PAGE_CODE = stripComments(PAGE);
const APP = stripComments(read('src/App.tsx'));
const NAV = stripComments(read('src/components/AdminLayout.tsx'));
const MIG = read('supabase/migrations/20260618120000_assignment_autoassign.sql');
// SQL 주석(-- ...) 제거 — 부정(.not) 검증이 설명 주석 단어로 거짓 실패하지 않도록.
const MIG_SQL = MIG.replace(/^\s*--.*$/gm, '');
const ROLLBACK = read('supabase/migrations/20260618120000_assignment_autoassign.rollback.sql');
const TYPES = read('src/lib/types.ts');
const DASH = stripComments(read('src/pages/Dashboard.tsx'));

// ── DB 마이그레이션 (ADDITIVE) ─────────────────────────────────────────────────
test.describe('DB — ADDITIVE 스키마 (DA dfd8 GO)', () => {
  test('#1 customers.assigned_consultant_id ADD COLUMN IF NOT EXISTS + FK staff ON DELETE SET NULL', () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS assigned_consultant_id\s+UUID REFERENCES staff\(id\) ON DELETE SET NULL/);
  });

  test('#2 assignment_actions 신규 audit 테이블 — action_type/role CHECK + append-only', () => {
    expect(MIG).toContain('CREATE TABLE IF NOT EXISTS assignment_actions');
    expect(MIG).toMatch(/action_type\s+TEXT NOT NULL CHECK \(action_type IN \('auto_assign', 'toss', 'pull_in', 'manual'\)\)/);
    expect(MIG).toMatch(/role\s+TEXT NOT NULL CHECK \(role IN \('consult', 'therapy'\)\)/);
    expect(MIG).toContain('check_in_id'); // 앵커
  });

  test('RLS = canonical user_profiles.id = auth.uid() (user_id 컬럼 비존재 버그 회피)', () => {
    expect(MIG).toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIG).toMatch(/SELECT clinic_id FROM user_profiles WHERE id = auth\.uid\(\)/);
    expect(MIG).not.toContain('user_profiles WHERE user_id = auth.uid()');
  });

  test('파괴적 변경 없음 — DROP TABLE/RENAME/DROP COLUMN 본 마이그에 없음', () => {
    expect(MIG_SQL).not.toMatch(/\bDROP TABLE\b/);
    expect(MIG_SQL).not.toMatch(/\bRENAME\b/);
    expect(MIG_SQL).not.toMatch(/\bDROP COLUMN\b/);
  });

  test('rollback SQL 동봉 — assignment_actions DROP + assigned_consultant_id DROP', () => {
    expect(ROLLBACK).toContain('DROP TABLE IF EXISTS assignment_actions');
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS assigned_consultant_id');
  });

  test('types.ts — assigned_consultant_id + AssignmentAction/Role/ActionType 추가', () => {
    expect(TYPES).toContain('assigned_consultant_id?: string | null;');
    expect(TYPES).toContain("export type AssignmentRole = 'consult' | 'therapy';");
    expect(TYPES).toContain("export type AssignmentActionType = 'auto_assign' | 'toss' | 'pull_in' | 'manual';");
    expect(TYPES).toContain('export interface AssignmentAction');
  });
});

// ── S1: 상담사 자동배정 (신규·균등) ─────────────────────────────────────────────
test.describe('S1 — 상담대기 진입 자동배정 + 균등 sublogic', () => {
  test('트리거: consult_waiting→consult / treatment_waiting→therapy 만 동작', () => {
    expect(ENGINE_CODE).toMatch(/newStatus === 'consult_waiting'\s*\?\s*'consult'/);
    expect(ENGINE_CODE).toMatch(/newStatus === 'treatment_waiting'\s*\?\s*'therapy'/);
  });

  test('Dashboard 슬롯 진입 훅에서 maybeAutoAssign 호출(상담대기/치료대기)', () => {
    expect(DASH).toContain("import { maybeAutoAssign }");
    expect(DASH).toMatch(/maybeAutoAssign\(row\.id, newStatus/);
    expect(DASH).toMatch(/newStatus === 'consult_waiting' \|\| newStatus === 'treatment_waiting'/);
  });

  test('균등 sublogic(질문②): ① 이달 동일 축 최소 → ② 당일 최소 → ③ 랜덤', () => {
    // pickLeastLoaded 정렬키 = monthly → today → rnd
    expect(ENGINE_CODE).toMatch(/a\.monthly - b\.monthly \|\| a\.today - b\.today \|\| a\.rnd - b\.rnd/);
  });

  test('후보 풀 = 당일 출근(구글시트 read) ∩ 역할 매칭', () => {
    expect(ENGINE_CODE).toContain('fetchTodayWorkingStaffIds');
    expect(ENGINE_CODE).toMatch(/role === targetRole && workingIds\.has\(s\.id\)/);
  });

  test('멱등·경합 안전 — 조건부 UPDATE(.is(col,null)) + 성공분만 로그', () => {
    expect(ENGINE_CODE).toMatch(/\.is\(assignedCol, null\)/);
    expect(ENGINE_CODE).toMatch(/if \(!updated \|\| updated\.length === 0\)/);
  });
});

// ── S2: 재진 (담당 실장 우선 · 월 균등 제외 · 카운트만) ──────────────────────────
test.describe('S2 — 재진 축 처리', () => {
  test('재진 판정 = visit_type==="returning" (lead_source enum 신설 금지 — DA #3 REJECT 준수)', () => {
    expect(ENGINE_CODE).toMatch(/c\.visit_type === 'returning'.*return 'returning'/s);
    // 재진 전용 lead_source enum 신설 흔적 없음
    expect(MIG_SQL).not.toMatch(/lead_source.*returning/i);
  });

  test('재진 = 월 균등 부하 산출 제외(continue) — 카운트만', () => {
    expect(ENGINE_CODE).toMatch(/if \(isReturningAxis\(a\.axis\)\) continue;/);
  });

  test('통합 뷰 — 재진 카운트는 균등(assigned)과 분리 집계', () => {
    // T-20260620 refine: staffStats 집계 정본을 assignment_actions→check_ins(monthAxisOf)로 이관.
    // 재진 축은 여전히 균등(assigned)과 분리된 returning 필드로 카운트.
    expect(PAGE_CODE).toMatch(/=== 'returning'\) st\.returning \+= 1/);
    expect(PAGE_CODE).toContain('returning:'); // StaffStat 별도 필드
  });
});

// ── S3: 치료사 자동배정 (지정 치료사 우선) ───────────────────────────────────────
test.describe('S3 — 지정 담당 0순위 우선 + 휴무 fallback(least-loaded)', () => {
  test('0순위: 상담=assigned_consultant_id / 치료=designated_therapist_id', () => {
    expect(ENGINE_CODE).toMatch(/customer\?\.assigned_consultant_id/);
    expect(ENGINE_CODE).toMatch(/customer\?\.designated_therapist_id/);
  });

  test('지정자 당일 출근 시에만 우선, 휴무면 균등 fallback', () => {
    expect(ENGINE_CODE).toMatch(/if \(designatedId && workingIds\.has\(designatedId\)\)/);
    expect(ENGINE_CODE).toMatch(/chosen = pickLeastLoaded\(pool, load\)/);
  });
});

// ── S4: 토스 (사유 필수 · 넘긴 사람 +1) ──────────────────────────────────────────
test.describe('S4 — 토스(handoff push)', () => {
  test('엔진: 사유 공백이면 거부', () => {
    expect(ENGINE_CODE).toMatch(/if \(!opts\.reason \|\| !opts\.reason\.trim\(\)\)/);
  });

  test('UI: 사유 빈값이면 토스 확정 비활성 + 에러 토스트', () => {
    // T-20260620 refine: 확정 버튼 disabled 에 사유 외 재배정 담당 미선택(reassign) 조건도 추가됨.
    expect(PAGE_CODE).toMatch(/busy \|\| !tossReason\.trim\(\)/);
    expect(PAGE_CODE).toMatch(/if \(!tossReason\.trim\(\)\)/);
    expect(PAGE_CODE).toContain("toast.error('토스 사유를 입력해주세요.')");
  });

  test('토스 N건 = 넘긴 사람(from_staff_id) 기준 누적 +1', () => {
    expect(PAGE_CODE).toMatch(/a\.action_type === 'toss' && a\.from_staff_id[\s\S]*?tossGiven \+= 1/);
  });

  test('토스는 넘긴 사람 제외한 풀에서 재배정', () => {
    // T-20260620 refine: 토스 재배정이 엔진 랜덤(least-loaded)에서 UI 수동 선택으로 변경.
    //   넘긴 사람 제외 풀 필터는 이제 PAGE 의 toss-staff-select 후보에서 적용된다.
    expect(PAGE_CODE).toMatch(/s\.id !== tossTarget\.fromStaffId/);
    expect(PAGE_CODE).toContain('data-testid="toss-staff-select"');
    // 엔진 토스는 명시 mode(reassign|unassign) 기반 — 랜덤 pickLeastLoaded 미사용.
    const tossBlock = ENGINE_CODE.slice(ENGINE_CODE.indexOf('export async function tossAssignment'));
    const tossOnly = tossBlock.slice(0, tossBlock.indexOf('export async function pullAssignment'));
    expect(tossOnly).toMatch(/mode: 'reassign' \| 'unassign'/);
    expect(tossOnly).not.toMatch(/pickLeastLoaded/);
    expect(ENGINE_CODE).toMatch(/actionType: 'toss'/);
  });
});

// ── S5: 당김 (상담대기 10분+ 또는 미배정 · cascade 없음) ─────────────────────────
test.describe('S5 — 당김(pull)', () => {
  test('당김 후보 = 상담대기/치료대기 ∧ (미배정 ∨ 대기 10분+)', () => {
    expect(PAGE_CODE).toContain('PULL_THRESHOLD_MIN = 10');
    expect(PAGE_CODE).toMatch(/unassigned \|\| waitMin >= PULL_THRESHOLD_MIN/);
  });

  test('당김 = 본인(myStaffId)에게 배정', () => {
    expect(PAGE_CODE).toMatch(/toStaffId: myStaffId/);
    expect(PAGE_CODE).toMatch(/user_id === profile\?\.id/);
  });

  test('당김 N건 = 받은 사람(to_staff_id) 기준 누적 +1', () => {
    expect(PAGE_CODE).toMatch(/a\.action_type === 'pull_in' && a\.to_staff_id[\s\S]*?pulled \+= 1/);
  });

  test('cascade 없음 — pullAssignment는 단건 update만(연쇄 앞당김 로직 부재)', () => {
    expect(ENGINE_CODE).toContain("actionType: 'pull_in'");
    // 슬롯 비우기/연쇄 재배정 호출 없음
    expect(ENGINE_CODE).not.toMatch(/cascade|shiftForward|앞당김/i);
  });
});

// ── S6: 통합 뷰 [상담·치료사 배정] + 라우트/네비 패리티 ──────────────────────────
test.describe('S6 — 통합 뷰 + 라우트·네비 패리티', () => {
  const ROLES = ['admin', 'manager', 'consultant', 'coordinator', 'therapist'];

  test('사이드바 라벨 = "상담·치료사 배정" → /admin/assignments', () => {
    expect(NAV).toMatch(/to: '\/admin\/assignments', label: '상담·치료사 배정'/);
  });

  test('nav roles === route RoleGuard roles (NAV-BOUNCE 차단 패리티)', () => {
    // nav
    for (const r of ROLES) expect(NAV).toContain(`'${r}'`);
    expect(NAV).toMatch(/assignments'[\s\S]*?roles: \['admin', 'manager', 'consultant', 'coordinator', 'therapist'\]/);
    // route
    expect(APP).toMatch(/path="assignments" element=\{<RoleGuard roles=\{\['admin', 'manager', 'consultant', 'coordinator', 'therapist'\]\}><Assignments/);
  });

  test('통합 뷰 3섹션 — 오늘 배정 현황 / 당김 후보 / 직원별 당월 누적', () => {
    expect(PAGE).toContain('오늘 배정 현황');
    expect(PAGE).toContain('당김 후보');
    expect(PAGE).toContain('직원별 당월 누적');
  });

  test('직원별 누적 = 배정(균등)+재진+토스+당김 4지표 노출', () => {
    expect(PAGE).toContain('배정(균등)');
    expect(PAGE).toContain('재진');
    expect(PAGE).toContain('토스');
    expect(PAGE).toContain('당김');
  });

  test('카운트 SSOT = assignment_actions count 파생 (별도 카운터 컬럼 신설 금지, DA #2)', () => {
    // 마이그에 toss_count/pull_count 같은 카운터 컬럼 없음
    expect(MIG_SQL).not.toMatch(/toss_count|pull_count|assigned_count/);
    expect(PAGE_CODE).toContain("from('assignment_actions')");
  });
});

// ── S7: 추가출근(ad-hoc) = deferred sub-task (본 디스패치 범위 외) ───────────────
test.describe('S7 — ad-hoc 출근은 deferred(본 코어에 미포함 확인)', () => {
  test('본 마이그에 staff_attendance/ad-hoc time-window 컬럼 없음(DA #5 supplement 대기)', () => {
    expect(MIG_SQL).not.toContain('staff_attendance');
    expect(MIG_SQL).not.toMatch(/shift_start|shift_end/);
  });
});
