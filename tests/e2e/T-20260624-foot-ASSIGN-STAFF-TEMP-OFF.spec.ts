/**
 * E2E spec — T-20260624-foot-ASSIGN-STAFF-TEMP-OFF
 *
 * 현장(김주연 총괄): 배정화면 직원별 누적 행, 금일 출근(녹색 동그라미) 옆에 '임시 off' 토글.
 *   담당자가 화장실/자리비움 등으로 자동배정에서 잠시 제외 — 출근(동그라미)은 유지, 복귀 가능.
 *
 * ── 설계(DA CONSULT-REPLY GO, DA-20260624-FOOT-STAFF-TEMP-OFF) ──
 *   body daily_room_inactive 동형 = "time-scoped daily exclusion". 신규 테이블 staff_temp_off:
 *     PK=(staff_id, work_date) / denorm clinic_id 제거(join-via-parent 격리) / work_date KST 캐스트 default /
 *     created_by→auth.users / row 존재=오늘 제외, delete=복귀, 익일 0시(KST) 자연복귀(cron 불요).
 *   ★ '임시 off' ≠ 휴무(staff_attendance off). 녹색 동그라미(workingIds)는 건드리지 않음.
 *
 * 정적 단언 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(갤탭 실토글→자동배정 제외/복귀 + 다중운영자 동기화)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const MIG = 'supabase/migrations/20260624170000_staff_temp_off.sql';
const ROLLBACK = 'supabase/migrations/20260624170000_staff_temp_off.rollback.sql';

// ─────────────────────────────────────────────────────────────────────────────
// 마이그레이션 — 신규 테이블 + 정련 ①②③ (KST 캐스트 / join-via-parent / created_by)
// ─────────────────────────────────────────────────────────────────────────────
test('MIG-1: staff_temp_off 신규 테이블, PK=(staff_id, work_date)', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS staff_temp_off/);
  expect(sql).toMatch(/PRIMARY KEY \(staff_id, work_date\)/);
  expect(sql).toMatch(/staff_id\s+uuid\s+NOT NULL REFERENCES staff\(id\) ON DELETE CASCADE/);
});

test('MIG-2: 정련① work_date KST 캐스트 default (UTC 자정 drift 방어)', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/work_date\s+date\s+NOT NULL DEFAULT \(now\(\) AT TIME ZONE 'Asia\/Seoul'\)::date/);
});

test('MIG-3: 정련② denorm clinic_id 컬럼 없음(join-via-parent 격리) + 검증가드', () => {
  const sql = read(MIG);
  // 컬럼 정의에 clinic_id 가 없어야 함
  expect(sql).not.toMatch(/clinic_id\s+uuid\s+NOT NULL REFERENCES clinics/);
  // 마이그 자체에 denorm clinic_id 부재 검증 DO 블록 포함
  expect(sql).toMatch(/column_name='clinic_id'/);
});

test('MIG-4: RLS = is_approved_user() + 부모 staff join (계약 §16-2 canonical)', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  expect(sql).toMatch(/is_approved_user\(\)/);
  expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM staff s/);
  expect(sql).toMatch(/s\.id = staff_temp_off\.staff_id/);
  expect(sql).toMatch(/s\.clinic_id = current_user_clinic_id\(\)/);
  expect(sql).toMatch(/FOR ALL TO authenticated/);
});

test('MIG-5: 정련③ created_by → auth.users(id) + 롤백은 DROP TABLE', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/created_by\s+uuid\s+REFERENCES auth\.users\(id\)/);
  const rb = read(ROLLBACK);
  expect(rb).toMatch(/DROP TABLE IF EXISTS staff_temp_off/);
});

// ─────────────────────────────────────────────────────────────────────────────
// lib — fetch/toggle (KST date 산출, graceful)
// ─────────────────────────────────────────────────────────────────────────────
test('LIB-1: fetchTodayTempOffStaffIds — work_date=오늘(KST) staff_temp_off 조회', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/export async function fetchTodayTempOffStaffIds/);
  expect(src).toMatch(/\.from\('staff_temp_off'\)/);
  expect(src).toMatch(/\.eq\('work_date', today\)/);
});

test('LIB-2: setStaffTempOff — on=upsert(onConflict PK) / off=delete, KST date', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/export async function setStaffTempOff/);
  expect(src).toMatch(/onConflict: 'staff_id,work_date'/);
  expect(src).toMatch(/\.from\('staff_temp_off'\)\s*\.delete\(\)/s);
  // KST date 로 산출(서버 default 동일)
  expect(src).toMatch(/todaySeoulISODate\(\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2/AC3 — 자동배정 후보풀에서 임시 off 제외(엔진 + 클라 양쪽)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: autoAssign 엔진 후보풀이 tempOff 제외(working && !tempOff)', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/const tempOff = await fetchTodayTempOffStaffIds\(\)/);
  expect(src).toMatch(/workingIds\.has\(s\.id\) && !tempOff\.has\(s\.id\)/);
});

test('AC2-2: 지정담당 0순위도 임시 off면 fallback(least-loaded)', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/designatedId && workingIds\.has\(designatedId\) && !tempOff\.has\(designatedId\)/);
});

test('AC3-1: 클라 poolFor(수동 후보)도 tempOff 제외', () => {
  const src = read(PAGE);
  expect(src).toMatch(/workingIds\.has\(s\.id\) && !tempOff\.has\(s\.id\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1/AC5 — 토글 버튼 UI(출근자에게만) + 녹색 동그라미 유지(workingIds 불변)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: 출근자(녹색 동그라미) 옆 임시 off 토글 버튼 렌더', () => {
  const src = read(PAGE);
  expect(src).toMatch(/temp-off-toggle-\$\{st\.staff\.id\}/);
  // 출근자에게만 노출(workingIds 게이트)
  expect(src).toMatch(/workingIds\.has\(st\.staff\.id\) && \(\s*<button/s);
  // ON/OFF 라벨
  expect(src).toMatch(/tempOff\.has\(st\.staff\.id\) \? '복귀' : '임시 off'/);
});

test('AC5-1: 녹색 동그라미는 workingIds 기준 유지(temp off 와 무관)', () => {
  const src = read(PAGE);
  // 동그라미 렌더 조건은 여전히 workingIds — tempOff 가 끼어들지 않음
  expect(src).toMatch(/bg-emerald-500/);
  expect(src).toMatch(/workingIds\.has\(st\.staff\.id\) && \(\s*<span[^>]*bg-emerald-500/s);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — 다중 운영자 동기화(Realtime 구독)
// ─────────────────────────────────────────────────────────────────────────────
test('AC4-1: staff_temp_off Realtime 구독 → tempOff 재조회', () => {
  const src = read(PAGE);
  expect(src).toMatch(/supabase\s*\.channel\(`staff_temp_off:/);
  expect(src).toMatch(/table: 'staff_temp_off'/);
  expect(src).toMatch(/fetchTodayTempOffStaffIds\(\)\.then\(setTempOff\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 토글 핸들러 — 낙관적 갱신 + 실패 롤백 + busy 가드
// ─────────────────────────────────────────────────────────────────────────────
test('TOG-1: toggleTempOff 낙관적 갱신 + 실패 롤백 + 중복클릭 가드', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const toggleTempOff = useCallback/);
  expect(src).toMatch(/if \(tempOffBusy\.has\(staffId\)\) return/);
  expect(src).toMatch(/setStaffTempOff\(staffId, turningOn, profile\?\.id \?\? null\)/);
});
