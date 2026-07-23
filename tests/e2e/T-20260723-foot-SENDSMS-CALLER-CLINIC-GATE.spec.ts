/**
 * T-20260723-foot-SENDSMS-CALLER-CLINIC-GATE
 * send-notification EF caller-clinic 미검증 봉쇄 (★P0 LIVE, clinics=2)
 *
 * 배경(부모 xcrm SENDSMS-CALLER-CLINIC-FORKINHERIT-SWEEP Phase-2): derm H-1 anti-pattern PRESENT.
 *   verifyRoleJwt 가 user_profiles.role 만 대조하고 caller 소속 clinic 을 대조하지 않아,
 *   인증된 스태프가 임의 body.clinic_id 지정 시 그 clinic 의 Vault 자격/발신번호로 cross-tenant
 *   실 발송 가능(test_sms / manual_send). manual_send 는 8역할 광범위 → 노출면 큼.
 *
 * 조치: provider·vault 접근 이전에 caller(auth.uid()) 소속 clinic ↔ body.clinic_id 대조 게이트,
 *   미소속 시 403. scheduled_send(service_role/X-Internal-Cron) 무회귀.
 *
 * 검증 성격: 게이트는 EF 백엔드 로직 → 실 발송/부정 케이스(403)는 supervisor EF-레벨 QA + deno
 *   regress test(caller-clinic-gate.regress.test.ts). 본 spec 은 실발송 없이 EF 소스 불변식을
 *   정적 검증한다(기존 foot SMS spec 패턴 T-20260608-SMS-CTXMENU-ALLROLE 동일).
 *
 * AC-1 두 경로(test_sms/manual_send) 게이트 존재 / AC-2 scheduled_send·system 무회귀 /
 * AC-3 감사 로그(BLOCK warn) / 식별=user_id(email 단독 금지)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const EF_PATH = 'supabase/functions/send-notification/index.ts';

function readEf(): string {
  return fs.readFileSync(path.join(REPO_ROOT, EF_PATH), 'utf8');
}

test.describe('caller-clinic 게이트 정적 불변식 (서버 불필요)', () => {
  test('helper: callerBelongsToClinic 존재', () => {
    const src = readEf();
    expect(src).toMatch(/async function callerBelongsToClinic\(userId: string, clinicId: string\)/);
  });

  test('식별=user_id(JWT sub): user_profiles.id / staff.user_id 로 조회 (email 단독필터 아님)', () => {
    const src = readEf();
    const fn = src.slice(src.indexOf('async function callerBelongsToClinic'));
    const body = fn.slice(0, fn.indexOf('// ── 메인 핸들러'));
    // user_profiles 는 id(=auth.uid) 로, staff 는 user_id 로 조회
    expect(body).toMatch(/from\("user_profiles"\)[\s\S]*?\.eq\("id", userId\)/);
    expect(body).toMatch(/from\("staff"\)[\s\S]*?\.eq\("user_id", userId\)/);
    expect(body).toMatch(/\.eq\("clinic_id", clinicId\)/);
    // 다지점 HQ 예외는 admin/manager/director 한정 (foot 정본 격리 규칙)
    expect(body).toMatch(/MULTI_CLINIC_HQ_ROLES/);
    expect(src).toMatch(/const MULTI_CLINIC_HQ_ROLES = \["admin", "manager", "director"\]/);
    // email 단독필터로 caller 를 신뢰하지 않는다
    expect(body).not.toMatch(/\.eq\("email"/);
  });

  test('AC-1: test_sms 경로에 게이트가 capability 조회(provider·vault) 이전에 존재', () => {
    const src = readEf();
    const testStart = src.indexOf('if (action === "test_sms")');
    const capIdx = src.indexOf('clinic_messaging_capability', testStart);
    const gateIdx = src.indexOf('callerBelongsToClinic(adminUserId, clinic_id)', testStart);
    expect(gateIdx).toBeGreaterThan(testStart);
    expect(gateIdx).toBeLessThan(capIdx); // 게이트가 vault/provider 접근 이전
  });

  test('AC-1: manual_send 경로에 게이트가 capability 조회 이전에 존재 (★8역할 필수)', () => {
    const src = readEf();
    const mStart = src.indexOf('if (action === "manual_send")');
    const capIdx = src.indexOf('clinic_messaging_capability', mStart);
    const gateIdx = src.indexOf('callerBelongsToClinic(adminUserId, clinic_id)', mStart);
    expect(gateIdx).toBeGreaterThan(mStart);
    expect(gateIdx).toBeLessThan(capIdx);
  });

  test('AC-1: 미소속 시 403 반환 (두 경로 모두)', () => {
    const src = readEf();
    // callerBelongsToClinic false → 403 응답 블록이 두 번 등장
    const matches = src.match(/!\(await callerBelongsToClinic\(adminUserId, clinic_id\)\)\)\s*\{[\s\S]*?status: 403/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2); // test_sms + manual_send
  });

  test('AC-2: 게이트는 user-JWT 도달(adminUserId)에만 적용 — service_role/크론 우회', () => {
    const src = readEf();
    // 게이트 조건이 반드시 `adminUserId &&` 로 가드됨 (adminUserId=null 인 service_role/cron 은 미적용)
    const guarded = src.match(/if \(adminUserId && !\(await callerBelongsToClinic\(adminUserId, clinic_id\)\)\)/g);
    expect(guarded).not.toBeNull();
    expect(guarded!.length).toBe(2);
  });

  test('AC-2: scheduled_send 경로는 게이트 미적용(내부 호출 전용 가드 유지)', () => {
    const src = readEf();
    const schedStart = src.indexOf('if (action === "scheduled_send")');
    const kwIdx = src.indexOf('keep_warm 액션', schedStart);
    const schedEnd = kwIdx >= 0 ? kwIdx : src.length;
    const schedBlock = src.slice(schedStart, schedEnd);
    // scheduled_send 내부엔 caller-clinic 게이트가 없어야 함(무신뢰 body 아님·DB row 기반)
    expect(schedBlock).not.toMatch(/callerBelongsToClinic/);
    // 대신 내부 호출 전용 가드(service_role/cron) 유지
    expect(schedBlock).toMatch(/if \(!isServiceRole && !isCronCall\)/);
  });

  test('AC-3: 차단 시 감사 로그(cross-tenant BLOCK) 기록', () => {
    const src = readEf();
    expect(src).toMatch(/test_sms cross-tenant BLOCK user=/);
    expect(src).toMatch(/manual_send cross-tenant BLOCK user=/);
  });
});
