/**
 * E2E spec — T-20260620-foot-PHRASE-MGMT-DOCTOR-HIDE (김주연 총괄, 풋센터 C0ATE5P6JTH)
 *
 * 확정 스펙 (옵션2/A안, slack ts 1781924207.232909):
 *   "봉직의/일반의사만 비노출, 대표원장(문지은 원장님)은 그대로 이용 가능 (앞으로 의사 추가돼도 자동 적용)"
 *
 * 변경 대상: 서비스관리 > 상용구 관리 서브탭(svc-top-tab-phrases) + ?tab=phrases 딥링크.
 *   - 비노출 조건: 의사 role(director) 중 운영최고권한(has_ops_authority) 없는 계정 = 봉직의/일반의사.
 *   - 유지 조건: 대표원장(director + 운영최고권한) · 전 직원(admin/manager/consultant/coordinator/
 *               therapist/part_lead/staff/technician/tm).
 *
 * AC-1: 봉직의/일반의사 → 메뉴 비노출
 * AC-2: 대표원장(role='director') → 접근 유지 (★lock-out 가드, 오전 c619eee8 incident 재현 금지)
 * AC-3: ?tab=phrases 딥링크 직접 접근도 차단(Route Guard 등가, Services.tsx 게이트)
 * AC-4: 향후 봉직의 추가 시 role/flag 기반 자동 비노출 (single-user 하드코딩 아님)
 * AC-5: 직원(admin/manager/coordinator/therapist 등) → 영향 없음(무회귀)
 * AC-6: 진료관리 탭 — 대표원장 포함 전체 영향 없음
 *
 * 실행: npx playwright test T-20260620-foot-PHRASE-MGMT-DOCTOR-HIDE.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canViewPhraseManagement } from '../../src/lib/permissions';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SERVICES = 'src/pages/Services.tsx';
const PERMISSIONS = 'src/lib/permissions.ts';

// ── 표본 프로필 ───────────────────────────────────────────────────────────────
const P = {
  director_chief:   { role: 'director' as const, has_ops_authority: true },    // 대표원장(문지은, flag 적재 후) — 노출
  director_stopgap: { role: 'director' as const, has_ops_authority: undefined }, // 대표원장(flag 미적재 현재) — STOPGAP escape 로 노출
  doctor_assoc:     { role: 'doctor' as const, has_ops_authority: false },      // 봉직의/일반의사(별 role) — 비노출
  coordinator:      { role: 'coordinator' as const, has_ops_authority: false }, // 직원 — 노출
  therapist:        { role: 'therapist' as const, has_ops_authority: false },   // 직원 — 노출
  consultant:       { role: 'consultant' as const, has_ops_authority: false },  // 직원 — 노출
  manager:          { role: 'manager' as const, has_ops_authority: false },     // 운영 role-implied — 노출
  admin:            { role: 'admin' as const, has_ops_authority: false },       // 슈퍼유저 — 노출
  staff:            { role: 'staff' as const, has_ops_authority: false },       // 직원 — 노출
  part_lead:        { role: 'part_lead' as const, has_ops_authority: false },   // 직원 — 노출
  tm:               { role: 'tm' as const, has_ops_authority: false },          // 직원 — 노출
};

// ── canViewPhraseManagement 로직 테이블 (순수 함수, 데이터·로그인 비의존) ──────────────
test.describe('PHRASE-MGMT-DOCTOR-HIDE — canViewPhraseManagement 게이트 로직', () => {
  test('AC-2: 대표원장(director + 운영최고권한) → 노출', () => {
    expect(canViewPhraseManagement(P.director_chief)).toBe(true);
  });

  test('AC-2 가드: 대표원장(flag 미적재, role=director) → STOPGAP escape 로 노출 (lock-out 금지)', () => {
    expect(canViewPhraseManagement(P.director_stopgap)).toBe(true);
    // role 문자열만 넘겨도 동일(하위호환 오버로드)
    expect(canViewPhraseManagement('director')).toBe(true);
  });

  test('AC-1: 봉직의/일반의사(의사 role 중 운영최고권한 없음) → 비노출', () => {
    // 향후 봉직의가 director 가 아닌 별 의사 role('doctor')로 등록되는 경우 = 즉시 비노출(AC-4 자동 적용).
    expect(canViewPhraseManagement(P.doctor_assoc)).toBe(false);
  });

  test('AC-5: 전 직원(admin/manager/consultant/coordinator/therapist/staff/part_lead/tm) → 노출(무회귀)', () => {
    expect(canViewPhraseManagement(P.admin)).toBe(true);
    expect(canViewPhraseManagement(P.manager)).toBe(true);
    expect(canViewPhraseManagement(P.consultant)).toBe(true);
    expect(canViewPhraseManagement(P.coordinator)).toBe(true);
    expect(canViewPhraseManagement(P.therapist)).toBe(true);
    expect(canViewPhraseManagement(P.staff)).toBe(true);
    expect(canViewPhraseManagement(P.part_lead)).toBe(true);
    expect(canViewPhraseManagement(P.tm)).toBe(true);
  });

  test('null/undefined/빈 role → false (안전 기본값)', () => {
    expect(canViewPhraseManagement(null)).toBe(false);
    expect(canViewPhraseManagement(undefined)).toBe(false);
    expect(canViewPhraseManagement({ role: undefined })).toBe(false);
  });

  test('AC-4: single-user 하드코딩 부재 — 특정 uid 비참조(role/flag 기반)', () => {
    const perm = read(PERMISSIONS);
    // canViewPhraseManagement 본문이 하드코딩된 uid/email 을 참조하지 않음(role·has_ops_authority 만).
    const fnStart = perm.indexOf('export function canViewPhraseManagement');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = perm.slice(fnStart, fnStart + 1200);
    // 하드코딩된 uid/slack-id 식별자 비참조(설명용 '문지은' 주석은 허용 — 실제 비교 로직만 금지).
    expect(fnBody).not.toMatch(/U0ALGAAAJAV|ee67fc6b/);
    expect(fnBody).not.toMatch(/\.id\s*===|uid\s*===|email\s*===/);
    expect(fnBody).toContain('hasOpsAuthority');
  });
});

// ── Services.tsx 배선 구조 불변식 ──────────────────────────────────────────────
test.describe('PHRASE-MGMT-DOCTOR-HIDE — Services.tsx 게이트 배선', () => {
  const svc = read(SERVICES);

  test('canViewPhraseManagement import + canViewPhrases 산출', () => {
    expect(svc).toContain("import { canViewPhraseManagement } from '@/lib/permissions'");
    expect(svc).toContain('const canViewPhrases = canViewPhraseManagement(profile)');
  });

  test('AC-1: 상용구관리 서브탭 버튼이 canViewPhrases 로 게이트(미권한 시 비노출)', () => {
    // 버튼이 canViewPhrases && (...) 조건부 렌더 안에 위치.
    const iGate = svc.indexOf('{canViewPhrases && (');
    const iBtn = svc.indexOf('data-testid="svc-top-tab-phrases"');
    expect(iGate).toBeGreaterThan(-1);
    expect(iBtn).toBeGreaterThan(iGate);
  });

  test('AC-3: ?tab=phrases 딥링크가 canViewPhrases 로 차단(Route Guard 등가)', () => {
    expect(svc).toContain('PHRASE_TAB_PARAMS.includes(tabParam) && canViewPhrases');
  });

  test('AC-3: effectiveTopTab 렌더 가드 — 미권한 phrases → services 강제 복귀', () => {
    expect(svc).toContain("canViewPhrases ? 'phrases' : 'services'");
  });

  test('AC-6: 진료관리 서브탭(svc-top-tab-clinic) 게이트는 canViewClinicMgmt 로 불변(상용구 게이트와 분리)', () => {
    // 진료관리 노출은 canViewClinicMgmt 유지 — canViewPhrases 로 대체/혼입 금지(영역 분리).
    expect(svc).toContain('data-testid="svc-top-tab-clinic"');
    const iClinicBtn = svc.indexOf('data-testid="svc-top-tab-clinic"');
    // 진료관리 버튼 주변 게이트는 canViewClinicMgmt.
    const around = svc.slice(Math.max(0, iClinicBtn - 400), iClinicBtn);
    expect(around).toContain('canViewClinicMgmt');
  });
});
