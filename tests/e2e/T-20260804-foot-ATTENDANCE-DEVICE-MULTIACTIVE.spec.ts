/**
 * T-20260804-foot-ATTENDANCE-DEVICE-MULTIACTIVE-INHERIT-LOOPFIX
 *   foot QR출퇴근 이식본 재승인 무한루프 상속수정 — 직원당 다기기 허용
 *   (부모 FIX 상속: T-20260802-crm-ATTENDANCE-DEVICE-MULTI-ACTIVE-REAPPROVAL-LOOP-FIX)
 *
 * 근본원인(foot 이식본 20260802180000_attendance_qr_port.sql — 롱레 FIX 미상속):
 *   ① L160 uq_attendance_device_active_staff (staff_id) WHERE active = 직원당 전역 1 active 강제
 *   ② approve_attendance_device 형제 active auto-revoke UPDATE(L488-489) = 새 기기 승인 시 기존 기기 죽임
 *   ③ device_token_hash 전역 UNIQUE 부재(롱레 belt 미상속)
 *   ⇒ 재승인이 working 기기 revoke → punch device_revoked → localStorage 삭제 → 재등록 강제 → 무한루프
 *
 * FIX(db_only): ①②③를 롱레 수정 그대로 상속(다기기 공존·형제-revoke 제거·token_hash 전역 UNIQUE).
 *   대리출근 방어는 현장 QR 회전토큰(변경 없음)이 담당. DDL/RPC 세션주입 실증은
 *   supervisor 라이브 QA(관리자 JWT + foot prod pg_indexes 실조회). 본 spec = 소스검증.
 *
 * ★골든타임: foot prod attendance_device=0행(현장 사용 前) → 무손실·무리스크·round-trip 안전.
 *
 * 티켓 GO-조건 매핑:
 *   [1] DROP uq_attendance_device_active_staff (다기기 물리허용)               → AC-1
 *   [2] ⭐device_token_hash 전역 단일컬럼 UNIQUE 필수추가(partial·복합 REJECT) → AC-1b
 *   [3] DROP+CREATE UNIQUE+RPC = 동일 up.sql(txn-control 리터럴 미포함)         → AC-1c
 *   [4] approve RPC 형제 revoke '블록만' 제거(user_profiles 스코프 등 나머지 보존) → AC-2, AC-3
 *   [5] pre-ADD dup 가드(fail-closed HALT)                                      → AC-1d
 *   [6] staff+active 단일행 read 전수감사(.single() throw 0)                    → AC-4 (punch=device_token_hash maybeSingle)
 *   [7] 롤백=조건부 one-way door(predicate 원문복사 + multi-active 축적 가드)   → AC-6
 *
 * 수용 기준(티켓 AC):
 *   (a) 기기1 active 상태에서 기기2 등록·승인해도 기기1 active 유지 → auto-revoke 부재로 성립(AC-2)
 *   (b) 기기1 원탭 출근 정상 → punch 가 device_token_hash 로 조회(staff-active 아님) (AC-4)
 *   (c) pg_indexes staff-active 유니크 부재 → DROP INDEX + 트랜잭션 내 게이트 (AC-1, supervisor prod 실조회)
 *   (d) 현장 QR 만료토큰 여전히 거부 → punch qr_token_stale 경로 무변경 (AC-5)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIG_SRC = resolve(__dirname, '../../supabase/migrations/20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.sql');
const RBK_SRC = resolve(__dirname, '../../supabase/migrations/20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.rollback.sql');
const EF_SRC = resolve(__dirname, '../../supabase/functions/attendance-otp/index.ts');

test.describe('T-20260804-foot-ATTENDANCE-DEVICE-MULTIACTIVE', () => {
  let mig: string, rbk: string, ef: string;

  test.beforeAll(() => {
    mig = readFileSync(MIG_SRC, 'utf-8');
    rbk = readFileSync(RBK_SRC, 'utf-8');
    ef = readFileSync(EF_SRC, 'utf-8');
  });

  // ── AC-1: 직원당 1 active 유니크 DROP (AC-c 근거) ───────────────────────────
  test('AC-1: uq_attendance_device_active_staff DROP INDEX (멱등)', () => {
    expect(mig).toMatch(/DROP INDEX IF EXISTS public\.uq_attendance_device_active_staff/);
    // 트랜잭션 내 게이트: 유니크 부재 자기점검(공백 유연)
    expect(mig).toMatch(/indexname\s*=\s*'uq_attendance_device_active_staff'/);
  });

  // ── AC-1b: device_token_hash 전역 단일컬럼 UNIQUE 필수추가(롱레 belt 상속) ─────
  test('AC-1b: uq_attendance_device_token_hash = 전역 단일컬럼 UNIQUE (partial·복합 REJECT)', () => {
    const create = mig.match(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_attendance_device_token_hash[\s\S]*?;/i);
    expect(create, 'uq_attendance_device_token_hash 생성 DDL 존재').not.toBeNull();
    const ddl = create![0];
    // 단일컬럼 (device_token_hash)
    expect(ddl).toMatch(/\(\s*device_token_hash\s*\)/);
    // partial-active 아님(WHERE 절 없음)
    expect(ddl).not.toMatch(/WHERE/i);
    // (staff_id, device_token_hash) 복합유니크 REJECT — DDL 문맥에 미생성
    expect(mig).not.toMatch(/CREATE[\s\S]{0,60}UNIQUE[\s\S]{0,60}INDEX[\s\S]{0,120}staff_id\s*,\s*device_token_hash/i);
    // partial-active token_hash 유니크 REJECT (device_token_hash ... WHERE status = 'active' 조합 미생성)
    expect(mig).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]{0,120}\(\s*device_token_hash\s*\)\s+WHERE/i);
  });

  // ── AC-1c: up.sql 원자성 — top-level txn-control 리터럴 미포함 ────────────────
  test('AC-1c: up.sql 에 BEGIN/COMMIT/ROLLBACK top-level txn-control 리터럴 부재(무영속 dry-run 보호)', () => {
    // 주석(-- ...)을 제거한 실행부만 검사
    const exec = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(exec).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(exec).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(exec).not.toMatch(/^\s*ROLLBACK\s*;/im);
    // DROP → CREATE UNIQUE → RPC 세 변경이 동일 파일에 공존(원자 배치)
    expect(mig).toMatch(/DROP INDEX IF EXISTS public\.uq_attendance_device_active_staff/);
    expect(mig).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_attendance_device_token_hash/i);
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.approve_attendance_device/);
  });

  // ── AC-1d: pre-ADD dup 가드(fail-closed HALT) ───────────────────────────────
  test('AC-1d: CREATE UNIQUE 전 device_token_hash 중복 HALT 가드 존재', () => {
    expect(mig).toMatch(/HAVING count\(\*\) > 1/);
    expect(mig).toMatch(/HALT\(§5 pre-ADD dup\)/);
    // 가드가 CREATE UNIQUE 보다 앞에 위치(중복 시 생성 차단)
    const guardIdx = mig.indexOf('HALT(§5 pre-ADD dup)');
    const createIdx = mig.search(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_attendance_device_token_hash/i);
    expect(guardIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(createIdx);
  });

  // ── AC-2: approve RPC 형제 auto-revoke 블록 제거 ────────────────────────────
  test('AC-2: approve_attendance_device 에 형제 active auto-revoke UPDATE 부재', () => {
    const fn = mig.match(/FUNCTION public\.approve_attendance_device[\s\S]*?\$\$;/);
    expect(fn, 'approve 함수 정의 존재').not.toBeNull();
    const body = fn![0];
    // 형제 revoke 패턴(status='revoked' WHERE staff_id=... AND status='active' AND id<>) 부재
    expect(body).not.toMatch(/SET\s+status\s*=\s*'revoked'\s+WHERE\s+staff_id\s*=\s*p_staff_id/);
    // 신규 기기 active 전환 UPDATE 는 유지
    expect(body).toMatch(/SET\s+staff_id\s*=\s*p_staff_id,\s*status\s*=\s*'active'/);
  });

  // ── AC-3: 형제 revoke 외 나머지 로직 원형 보존(foot 이식본 user_profiles 스코프 회귀 금지) ─
  test('AC-3: approve RPC 는 foot 이식본(20260802180000) user_profiles·v_mgr_clinic 원형 보존', () => {
    const fn = mig.match(/FUNCTION public\.approve_attendance_device[\s\S]*?\$\$;/)![0];
    // foot 이식본 스코프: user_profiles 매니저 검증 + v_mgr_clinic (롱레 is_staff_clinic/is_manager_or_above 아님)
    expect(fn).toContain('public.user_profiles');
    expect(fn).toContain('v_mgr_clinic');
    expect(fn).toMatch(/role IN \('admin','manager','director'\)/);
    // 롱레 헬퍼 미사용(도메인 격리 — foot 이식본 원형)
    expect(fn).not.toContain('is_staff_clinic');
    expect(fn).not.toContain('is_manager_or_above');
    // device.clinic 스코프 검증 유지(v_dev_clinic <> v_mgr_clinic)
    expect(fn).toMatch(/v_dev_clinic\s*<>\s*v_mgr_clinic/);
    // staff 는 매니저 지점 귀속 검증 유지
    expect(fn).toMatch(/v_staff_clinic\s+IS NULL OR v_staff_clinic\s*<>\s*v_mgr_clinic/);
    // pending·active-staff 가드 유지
    expect(fn).toMatch(/v_dev_status\s*<>\s*'pending'/);
    // 감사 로그 매니저 clinic 기준 유지
    expect(fn).toMatch(/attendance_audit[\s\S]*?VALUES \(v_mgr_clinic,/);
    // SECDEF·search_path 핀 보존
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('SET search_path = public');
  });

  // ── AC-3b: grant seal 보존(REVOKE anon + GRANT authenticated) ────────────────
  test('AC-3b: approve RPC grant seal — anon EXEC 금지·authenticated 전용', () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.approve_attendance_device\(UUID, UUID\) FROM PUBLIC, anon/);
    expect(mig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.approve_attendance_device\(UUID, UUID\) TO authenticated/);
  });

  // ── AC-4: punch 는 device_token_hash 로 조회 (staff+active 단일행 read 아님) ──
  test('AC-4: EF punch_device 는 device_token_hash 키 maybeSingle (다기기 안전, .single() throw 0)', () => {
    // punch 는 기기 유일키(device_token_hash)로 조회 — 직원당 다기기여도 충돌 없음
    expect(ef).toMatch(/\.eq\("device_token_hash",\s*h\)\s*\.maybeSingle\(\)/);
    // staff+active 를 .single() 로 조회하는 취약 패턴 부재(전수감사)
    expect(ef).not.toMatch(/\.eq\("staff_id"[\s\S]{0,80}\.eq\("status",\s*"active"\)[\s\S]{0,40}\.single\(\)/);
    // active/staff_id 검증은 조회된 단일 기기행 기준(다기기와 무관)
    expect(ef).toContain('devRow.status !== "active"');
  });

  // ── AC-5: (d) 현장 QR 만료토큰 거부 경로 무변경(대리출근 방어 유지) ──────────
  test('AC-5: punch 의 QR 신선도(qr_token_stale) 거부 경로 불변', () => {
    expect(ef).toContain('qr_token_stale');
    // punch_device 는 verifyToken(qrKey, token) 통과 후에만 진행(현장존재 강제)
    const punch = ef.match(/action === "punch_device"[\s\S]*?return res;/);
    expect(punch, 'punch_device 핸들러 존재').not.toBeNull();
    expect(punch![0]).toMatch(/verifyToken\(qrKey,\s*token\)/);
    // 본 티켓 마이그는 QR/HMAC/vault 미접촉
    expect(mig).not.toContain('attendance_qr_hmac_key');
    expect(mig).not.toContain('get_vault_secret');
  });

  // ── AC-6: 롤백 = 조건부 one-way door ────────────────────────────────────────
  test('AC-6: 롤백 마이그는 predicate 원문복사 + multi-active 축적 가드', () => {
    // predicate 원문 복사(20260802180000 L160-161)
    expect(rbk).toContain('ON public.attendance_device (staff_id) WHERE status = \'active\'');
    // 축적 시 파괴 방지 가드(active≥2 staff 존재 시 롤백 중단)
    expect(rbk).toMatch(/HAVING count\(\*\) > 1/);
    expect(rbk).toMatch(/ROLLBACK 중단\(one-way door\)/);
    // 형제 auto-revoke 복원(롤백은 원본 동작 복구)
    expect(rbk).toMatch(/SET status = 'revoked'\s*\n?\s*WHERE staff_id = p_staff_id/);
    // 데이터 무손실 — attendance_device DROP/DELETE 없음
    expect(rbk).not.toMatch(/DROP TABLE|DELETE FROM public\.attendance_device/);
  });
});
