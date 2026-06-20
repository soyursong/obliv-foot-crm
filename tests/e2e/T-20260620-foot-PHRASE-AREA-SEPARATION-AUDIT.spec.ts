/**
 * E2E spec — T-20260620-foot-PHRASE-AREA-SEPARATION-AUDIT  (AC-4)
 *
 * 출처: 김주연 총괄 MSG-20260620-085544-dnix 결정2.
 *
 * AC-4 (어드민 상용구 관리탭 접근권한 = 직원만, 의사 제외):
 *   - 상용구관리 서브탭(펜차트/고객차트/수가세트 = 직원영역 상용구)은 director(의사)에게 노출 금지.
 *   - "직원 업무" 원칙 — director 진입점 숨김(NO-DDL FE 게이트).
 *   - ⚠ surface 단위 분리: 진료관리(의사영역 medical_chart) 상용구는 별도 surface
 *     (ClinicManagement > 상용구(진료차트), PhrasesTab lockedType="medical_chart")로
 *     director 편집 유지(AC-3). 본 게이트는 직원영역 상용구관리 서브탭만 닫음 → lock-out 없음.
 *
 * 구조 불변식을 정본 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀 가드).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SERVICES = 'src/pages/Services.tsx';
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';

// ── AC-4: 상용구관리 서브탭 게이트 = 직원만, director(의사) 제외 ────────────────
test('AC-4: canViewPhraseMgmt 게이트 존재 + director 제외(denylist)', () => {
  const svc = read(SERVICES);
  expect(svc).toContain('canViewPhraseMgmt');
  // 직원만 = role 보유 && director 아님
  expect(svc).toMatch(/canViewPhraseMgmt\s*=\s*!!profile\?\.role\s*&&\s*profile\.role\s*!==\s*'director'/);
});

test('AC-4: 상용구관리 탭 버튼이 canViewPhraseMgmt 로 가드됨', () => {
  const svc = read(SERVICES);
  // 탭 버튼 testid 가 canViewPhraseMgmt 조건부 블록 안에 있어야 함
  expect(svc).toMatch(/canViewPhraseMgmt\s*&&\s*\([\s\S]*?data-testid="svc-top-tab-phrases"/);
});

test('AC-4: effectiveTopTab phrases 렌더 가드 = canViewPhraseMgmt (자격 박탈 시 services 폴백)', () => {
  const svc = read(SERVICES);
  expect(svc).toMatch(/canViewPhraseMgmt\s*\?\s*'phrases'\s*:\s*'services'/);
});

test('AC-4: 딥링크(?tab=phrases) 도 canViewPhraseMgmt 로 가드 — director 폴백', () => {
  const svc = read(SERVICES);
  // 초기 state
  expect(svc).toMatch(/isPhraseParam\s*&&\s*canViewPhraseMgmt\s*\?\s*'phrases'\s*:\s*'services'/);
  // 딥링크 동기화 useEffect
  expect(svc).toMatch(/if\s*\(isPhraseParam\s*&&\s*canViewPhraseMgmt\)/);
});

// ── surface 단위 분리: 의사영역(medical_chart) 상용구는 director 편집 유지(AC-3) ──
test('AC-4: 진료관리(의사영역) medical_chart 상용구 surface 는 별도 유지(lock-out 방지)', () => {
  const clinic = read(CLINIC_MGMT);
  // 진료차트 상용구 = PhrasesTab lockedType="medical_chart" — 의사영역 surface 보존
  expect(clinic).toContain('lockedType="medical_chart"');
});

test('AC-4: 진료관리 서브탭은 director 진입 유지 — 직원영역 게이트와 직교', () => {
  const svc = read(SERVICES);
  // 진료관리 게이트는 canViewClinicMgmt(=!!profile?.role) — director 포함 유지
  expect(svc).toContain('canViewClinicMgmt = !!profile?.role');
  // 직원영역 게이트(canViewPhraseMgmt)와 의사영역 게이트(canViewClinicMgmt)는 별개여야 함
  expect(svc).not.toMatch(/canViewClinicMgmt\s*=\s*!!profile\?\.role\s*&&\s*profile\.role\s*!==\s*'director'/);
});
