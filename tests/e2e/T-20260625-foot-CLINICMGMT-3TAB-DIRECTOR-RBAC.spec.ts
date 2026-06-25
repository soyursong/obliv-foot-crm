/**
 * E2E spec — T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC
 *
 * 현장(문지은 대표원장, director):
 *   진료관리(서비스관리) 3탭 — 슈퍼상용구 / 상용구(진료차트) / 서류 템플릿 — 편집 불가.
 *
 * RC (코드 그라운딩): FE canEdit 가 role==='admin' 하드코딩 → director 누락 (FE↔RLS RBAC 드리프트).
 *   BUNDLERX-ICON-NOAPPLY(a75cf28f) 형제 탭. 동일 클래스 RC.
 *
 * part1 (본 spec 대상, FE):
 *   3곳 canEdit 에 `|| profile?.role === 'director'` escape 추가.
 *   - SuperPhrasesTab.tsx : 무조건(슈퍼상용구 = 의사영역)
 *   - DocumentTemplatesTab.tsx : 무조건(서류 템플릿 = 의사영역)
 *   - PhrasesTab.tsx : isMedchartSurface(진료차트) 분기 내부만 — 직원영역(pen/customer) 무변경
 *   stopgap: RLS director 도 동시 수렴 — has_ops_authority 적재 시 일괄 제거(주석 부기).
 *
 * 시나리오 1 (복구): director 가 3탭 모두 canEdit=true.
 * 시나리오 2 (무회귀): admin 유지 / staff 영역(canEditStaffAreaPhrase) 무변경 / medchart admin 유지.
 *
 * 정적 소스 단언(데이터/로그인 비의존). db_change:false (FE only). RLS=part2 별도.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SUPER = 'src/components/admin/SuperPhrasesTab.tsx';
const PHRASE = 'src/components/admin/PhrasesTab.tsx';
const DOC = 'src/components/admin/DocumentTemplatesTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (복구): director escape 추가 — 3탭 canEdit director 허용
// ─────────────────────────────────────────────────────────────────────────────
test('S1-1: 슈퍼상용구 canEdit 가 admin OR director 를 허용한다', () => {
  const src = read(SUPER);
  expect(src).toMatch(/const canEdit = profile\?\.role === 'admin' \|\| profile\?\.role === 'director'/);
});

test('S1-2: 서류 템플릿 canEdit 가 admin OR director 를 허용한다', () => {
  const src = read(DOC);
  expect(src).toMatch(/const canEdit = profile\?\.role === 'admin' \|\| profile\?\.role === 'director'/);
});

test('S1-3: 진료차트 상용구(medchart surface)는 admin OR director 를 허용한다', () => {
  const src = read(PHRASE);
  // isMedchartSurface 분기 내부 truthy 에 director escape
  expect(src).toMatch(/isMedchartSurface\s*\?\s*profile\?\.role === 'admin' \|\| profile\?\.role === 'director'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (무회귀)
// ─────────────────────────────────────────────────────────────────────────────
test('S2-1: 진료차트 외 직원영역은 canEditStaffAreaPhrase 그대로(director escape 미침투)', () => {
  const src = read(PHRASE);
  // else 분기(직원영역)는 무변경 — staff area 헬퍼 유지
  expect(src).toMatch(/:\s*canEditStaffAreaPhrase\(profile\?\.role\)/);
});

test('S2-2: 3탭 모두 stopgap 주석으로 RLS 수렴 + 출처 티켓을 남긴다(회귀 추적)', () => {
  for (const p of [SUPER, PHRASE, DOC]) {
    const src = read(p);
    expect(src).toContain('T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC');
    expect(src).toContain('has_ops_authority');
  }
});

test('S2-3: director escape 는 admin 허용을 제거하지 않는다(superset — 기존 admin 유지)', () => {
  for (const p of [SUPER, DOC]) {
    const src = read(p);
    expect(src).toContain("profile?.role === 'admin'");
  }
});
