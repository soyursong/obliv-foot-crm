/**
 * T-20260622-foot-AUTOASSIGN-IMBYEOL-SKEW-FIX — 임별 쏠림 교정 Phase2 (A안)
 *
 * 현장 결정(김주연 총괄, MSG-20260622-205352-9hdb):
 *   Q3=YES 즉시수정 / Q1=A안(지정치료사 존중 유지 + 버그만) / Q2=유지 / ③ 휴무 폴백=현행 충족.
 *
 * 본체 = Q3 부하기록 버그 수정: 자동배정 엔진 밖 실배정(드래그-방 배정)도
 *   assignment_actions(manual)에 기록 → computeLoad 전원0 오판 제거 → 신규·비지정
 *   영역 월 균등 복원. 정책·구조 변경 0(A안 경계).
 *
 * 라이브 env 비의존 정적 소스 검증(레포 dominant 패턴, BALANCE-TOSS spec 동형).
 *   S1 logRealAssignment 헬퍼 계약  S2 드래그-방 배정 부하기록 wiring
 *   S3 A안 경계(B 레버 미적용)        S4 db_change=verify(스키마 무변경)
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
const DASH = stripComments(read('src/pages/Dashboard.tsx'));
const MIG = read('supabase/migrations/20260618120000_assignment_autoassign.sql');

// logRealAssignment 함수 본문만 슬라이스(인접 함수 오염 방지)
const lraStart = ENGINE_CODE.indexOf('export async function logRealAssignment');
const LRA = lraStart >= 0 ? ENGINE_CODE.slice(lraStart) : '';

// ── S1: logRealAssignment 헬퍼 계약 ─────────────────────────────────────────────
test.describe('S1 — logRealAssignment(실배정 부하기록) 헬퍼', () => {
  test('엔진에 export 존재', () => {
    expect(ENGINE_CODE).toContain('export async function logRealAssignment');
  });

  test('action_type=manual 로 assignment_actions 기록(SSOT 공백 보강)', () => {
    expect(LRA).toMatch(/actionType: 'manual'/);
    expect(LRA).toContain('logAssignment(');
  });

  test('치료 축=deriveTherapyAxis(check_in) / 상담 축=customer 보조조회→deriveConsultAxis', () => {
    expect(LRA).toMatch(/role === 'therapy'/);
    expect(LRA).toContain('deriveTherapyAxis(opts.checkIn)');
    expect(LRA).toContain('deriveConsultAxis(');
    expect(LRA).toMatch(/from\('customers'\)[\s\S]*?visit_type, lead_source, visit_route/);
  });

  test('멱등 — 담당 변화 없으면(to===from) skip + 미배정(null)은 기록 안 함', () => {
    expect(LRA).toMatch(/if \(!opts\.toStaffId\) return;/);
    expect(LRA).toMatch(/if \(opts\.toStaffId === \(opts\.fromStaffId \?\? null\)\) return;/);
  });

  test('best-effort — 실패해도 throw 안 함(배정 동선 비차단)', () => {
    expect(LRA).toMatch(/try \{[\s\S]*?\} catch \(e\) \{[\s\S]*?console\.warn\('\[autoAssign\] logRealAssignment failed:'/);
  });
});

// ── S2: 드래그-방 배정 부하기록 wiring (시나리오1 핵심) ──────────────────────────
test.describe('S2 — 드래그-방 배정도 부하 SSOT에 기록', () => {
  test('Dashboard 가 logRealAssignment import', () => {
    expect(DASH).toContain('logRealAssignment');
    expect(DASH).toMatch(/import \{ maybeAutoAssign, logRealAssignment \}/);
  });

  test('상담실 드롭=consult / 치료실 드롭=therapy 역할로 부하기록', () => {
    expect(DASH).toMatch(/roomType === 'consultation'[\s\S]*?dragAssignRole = 'consult'/);
    expect(DASH).toMatch(/roomType === 'treatment'[\s\S]*?dragAssignRole = 'therapy'/);
  });

  test('직전 담당(from)을 row 에서 캡처 → 변화 시에만 기록(중복 부하 방지)', () => {
    expect(DASH).toMatch(/dragAssignFrom = row\.consultant_id \?\? null/);
    expect(DASH).toMatch(/dragAssignFrom = row\.therapist_id \?\? null/);
    expect(DASH).toMatch(/if \(dragAssignRole && dragAssignTo && dragAssignTo !== dragAssignFrom\)/);
  });

  test('saveCheckInMove 성공 후에만 부하기록(실패 시 롤백 경로엔 미발화)', () => {
    // logRealAssignment 호출이 saveCheckInMove 실패 early-return 뒤에 위치
    const saveIdx = DASH.indexOf('const res = await saveCheckInMove(row.id, patch);');
    const callIdx = DASH.indexOf('void logRealAssignment({');
    expect(saveIdx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(saveIdx);
  });
});

// ── S3: A안 경계 — B 레버 미적용(정책·구조 변경 0) ──────────────────────────────
test.describe('S3 — A안 경계(B 레버 손대지 않음)', () => {
  test('재진=월 균등 제외 그대로(:171 continue 유지) — B레버 "재진 균등포함" 미적용', () => {
    expect(ENGINE_CODE).toMatch(/if \(isReturningAxis\(a\.axis\)\) continue;/);
  });

  test('지정치료사 0순위 존중 유지 — 부하 cap 신설 없음', () => {
    expect(ENGINE_CODE).toMatch(/if \(designatedId && workingIds\.has\(designatedId\)\)/);
    // 지정자에 평균 N배 cap 같은 양보 로직 미도입
    expect(ENGINE_CODE).not.toMatch(/designated[\s\S]{0,80}cap|cap[\s\S]{0,80}designated/i);
  });

  test('computeLoad 균등 산출식 불변 — monthly→today→rnd 정렬키 그대로', () => {
    expect(ENGINE_CODE).toMatch(/a\.monthly - b\.monthly \|\| a\.today - b\.today \|\| a\.rnd - b\.rnd/);
  });

  test('선호치료사→designated 역동기화(Reservations) 중단하지 않음(Q2=유지)', () => {
    const RESV = stripComments(read('src/pages/Reservations.tsx'));
    expect(RESV).toMatch(/visit_type === 'returning' && input\.preferred_therapist_id && input\.customerId/);
    expect(RESV).toContain('designated_therapist_id: input.preferred_therapist_id');
  });
});

// ── S4: db_change=verify — 스키마 무변경(기존 컬럼·CHECK 재사용) ─────────────────
test.describe('S4 — 스키마 무변경(기존 assignment_actions 재사용)', () => {
  test("'manual' action_type 이미 CHECK 제약에 존재 → 신규 마이그 불필요", () => {
    expect(MIG).toMatch(/action_type\s+TEXT NOT NULL CHECK \(action_type IN \('auto_assign', 'toss', 'pull_in', 'manual'\)\)/);
  });

  test('logRealAssignment 가 기존 컬럼만 사용(신규 컬럼 INSERT 없음)', () => {
    // logAssignment 위임 → clinic_id/check_in_id/action_type/role/axis/from_staff_id/to_staff_id/created_by(기존)
    expect(LRA).toContain('logAssignment(');
    expect(LRA).not.toMatch(/ALTER TABLE|ADD COLUMN/);
  });
});
