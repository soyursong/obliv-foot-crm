/**
 * E2E spec — T-20260629-foot-ASSIGN-TEMPOFF-TOGGLE-FAIL
 *
 * 현상(reporter, 스크린샷 F0BDNJKM267): 배정화면 '직원별 당월 누적' 표에서 직원 '임시 off'
 *   토글 시 "임시 off 변경에 실패했습니다. 다시 시도해주세요." 에러 토스트(write 실패).
 *   읽기/표시는 정상.
 *
 * ── 진단(런타임 규명, RC-first) ──
 *   콘솔/RLS 가 아니라 **스키마 부재**가 RC. 부모 T-20260624-foot-ASSIGN-STAFF-TEMP-OFF 의
 *   마이그레이션(20260624170000_staff_temp_off.sql)이 레포에는 커밋(65039adc)됐으나
 *   **라이브 DB 에 적용되지 않음** → PostgREST PGRST205 'Could not find the table
 *   public.staff_temp_off in the schema cache'.
 *     · write: `.from('staff_temp_off').upsert(...)` → 404(PGRST205) → setStaffTempOff=false
 *              → toast '임시 off 변경에 실패했습니다.'  (= 현장 증상)
 *     · read : fetchTodayTempOffStaffIds 가 try/catch 로 404 를 삼켜 빈 Set 반환 → '표시 정상'처럼 보임.
 *
 * ── 조치 ──
 *   FE/lib 코드는 이미 정상(부모 티켓 구현 완전). 코드 변경 0. **누락된 additive 마이그 적용만**
 *   (DA-20260624-FOOT-STAFF-TEMP-OFF GO 기적용 + autonomy §3.1 ADDITIVE 대표게이트 면제).
 *   라이브 적용 후: staff-role 사용자 INSERT(off)/DELETE(복귀) 양방향 RLS 통과 검증 완료.
 *
 * ── 회귀 가드(이 spec 의 목적) ──
 *   기존 부모 spec 은 마이그 '파일 텍스트'만 단언 → 파일이 커밋돼도 미적용이면 통과(=이번 사고 유발).
 *   본 spec 은 그 갭을 닫는다:
 *     (A) 정적: lib write 경로 보존(코드 회귀 가드).
 *     (B) 라이브: PostgREST 로 staff_temp_off 도달성 직접 확인 — 테이블 부재(PGRST205/404)면 FAIL.
 *         '커밋됐으나 미적용' 사고를 코드레벨이 아니라 런타임으로 잡는다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// (A) 정적 — write 경로 회귀 가드 (코드는 정상이어야 함)
// ─────────────────────────────────────────────────────────────────────────────
test('STATIC-1: setStaffTempOff upsert/delete 경로 보존(on=upsert PK, off=delete)', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/export async function setStaffTempOff/);
  expect(src).toMatch(/\.from\('staff_temp_off'\)\s*\.upsert\(/s);
  expect(src).toMatch(/onConflict: 'staff_id,work_date'/);
  expect(src).toMatch(/\.from\('staff_temp_off'\)\s*\.delete\(\)/s);
});

test('STATIC-2: 토글 실패 시 롤백+토스트(현장 증상 트리거 지점 보존)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/setStaffTempOff\(staffId, turningOn, profile\?\.id \?\? null\)/);
  expect(src).toMatch(/임시 off 변경에 실패했습니다\. 다시 시도해주세요\./);
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) 라이브 — staff_temp_off 도달성(스키마 적용) 가드. ★이번 RC 직접 회귀.
//     테이블 부재 → PostgREST 404 PGRST205. 적용됨 → 200([] 또는 RLS-empty).
//     env(URL/anon) 없으면 skip(맥스튜디오 실행 환경에서 활성).
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_CRM_FOOT_URL ?? '';
const SUPA_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_CRM_FOOT_ANON ?? '';

test('LIVE-1: staff_temp_off 가 라이브 DB 에 존재(PGRST205 부재) — 커밋됐으나 미적용 사고 가드', async () => {
  test.skip(!SUPA_URL || !SUPA_ANON, 'VITE_SUPABASE_URL/ANON env 없음 — 라이브 가드 skip');
  const res = await fetch(
    `${SUPA_URL.replace(/\/$/, '')}/rest/v1/staff_temp_off?select=staff_id&limit=1`,
    { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${SUPA_ANON}` } },
  );
  const body = await res.text();
  // 테이블 부재면 404 + PGRST205. 존재하면 200(혹은 RLS 로 [] ) — 어느 쪽이든 'not found' 아님.
  expect(res.status, `staff_temp_off 도달 실패(status=${res.status}, body=${body})`).not.toBe(404);
  expect(body).not.toContain('PGRST205');
  expect(body).not.toContain('Could not find the table');
});
