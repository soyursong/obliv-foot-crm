/**
 * E2E Spec — T-20260819-foot-VIEWERONLY-WONJANG-ACCOUNT-ORIGIN (P1, foot)
 *
 * 뷰어전용(read-only) 계정 write 초크포인트 FE-1차 착수(planner GATE A ★조종 결정, MSG-20260819-131818-pn41).
 *   ★hybrid(b 미채택): FE choke-point 코드(useReadOnly() + permissions write predicate 단락) = 구현/랜딩 OK,
 *     단 read_only=true flag 부여 前까지 inert(기존 계정 0 behavior change · scenario3 안전).
 *   ★uniform — 의료 carve-out 하지 말 것. 진료 write(canIssueProgressDocs)도 동일 flag 로 단락.
 *     계정 LIVE 활성화(진료 PHI 열람)는 문원장 medical 컨펌 後 = HOLD(코드 아닌 provisioning 단계 게이트).
 *
 * 본 티켓 착수 범위(코드): choke-point atom(isViewerOnly) + uniform wrapper(gateViewerWrite) +
 *   subject-accepting write predicate 3종 단락 + useReadOnly() 훅. 실제 계정 생성·flag 부여 = HOLD(미포함).
 *
 * 검증 구성:
 *   A. 초크포인트 atom — isViewerOnly (read_only=true → true / undefined·false·null → false).
 *   B. uniform wrapper — gateViewerWrite (뷰어면 무조건 false, 아니면 allowed 통과).
 *   C. subject-accepting write predicate 단락 (의료 포함, uniform · carve-out 없음).
 *   D. inert 불변식 — read_only flag 부재(undefined) 시 모든 predicate 기존과 동일(회귀 0).
 *   E. 정적 소스 가드 — useReadOnly 훅 배선 · DDL_DIFF_HOLD(마이그 미동반) · 실계정 생성 미포함.
 *   F. 브라우저 회귀 가드(HTTP 200).
 *
 * 검증 방식: 순수 술어 단언(현장 PHI 계정 불요 · flag 미부여라 실계정 뷰어경로는 자동화 불가) +
 *   정적 구조 가드 + 앱 로드. 실브라우저 뷰어 클릭 시나리오는 하단 체크리스트(계정 LIVE 활성화 後 = HOLD 대상).
 *
 * 실행: npx playwright test T-20260819-foot-VIEWERONLY-WONJANG-ACCOUNT-ORIGIN.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isViewerOnly,
  isReadOnlyFromAppMetadata,
  gateViewerWrite,
  canEditClinicMgmt,
  canEditConfirmedClosing,
  canIssueProgressDocs,
  canEditCustomer,
  canRequestOpinionDoc,
  hasOpsAuthority,
  canAccess,
  type OpsAuthSubject,
} from '../../src/lib/permissions';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '../..', rel), 'utf-8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// 계정 프로필 팩토리.
function subject(over: Partial<OpsAuthSubject> = {}): OpsAuthSubject {
  return { role: 'director', ...over };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 초크포인트 atom — isViewerOnly
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. isViewerOnly atom', () => {
  test('A1: read_only=true → true', () => {
    expect(isViewerOnly(subject({ read_only: true }))).toBe(true);
    expect(isViewerOnly({ role: 'admin', read_only: true })).toBe(true);
  });

  test('A2: read_only 부재(undefined)/false/null → false (inert 기본값)', () => {
    expect(isViewerOnly(subject())).toBe(false);
    expect(isViewerOnly(subject({ read_only: false }))).toBe(false);
    expect(isViewerOnly(subject({ read_only: null }))).toBe(false);
  });

  test('A3: null/undefined subject → false (null-safe)', () => {
    expect(isViewerOnly(null)).toBe(false);
    expect(isViewerOnly(undefined)).toBe(false);
  });

  test('A4: ★Option B 소스★ isReadOnlyFromAppMetadata(app_metadata.read_only) — JWT claim reader', () => {
    expect(isReadOnlyFromAppMetadata({ read_only: true })).toBe(true);
    expect(isReadOnlyFromAppMetadata({ read_only: false })).toBe(false);
    expect(isReadOnlyFromAppMetadata({})).toBe(false); // 미부여 = inert
    expect(isReadOnlyFromAppMetadata(null)).toBe(false);
    expect(isReadOnlyFromAppMetadata(undefined)).toBe(false);
    // truthy 오탐 방지 — 문자열 'false'/'true' 는 === true 아님(엄격).
    expect(isReadOnlyFromAppMetadata({ read_only: 'true' as unknown })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. uniform wrapper — gateViewerWrite
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B. gateViewerWrite uniform wrapper', () => {
  test('B1: 뷰어전용이면 allowed=true 여도 false 로 단락', () => {
    expect(gateViewerWrite(subject({ read_only: true }), true)).toBe(false);
    expect(gateViewerWrite(subject({ read_only: true }), false)).toBe(false);
  });

  test('B2: 뷰어 아니면 allowed 그대로 통과(무회귀)', () => {
    expect(gateViewerWrite(subject(), true)).toBe(true);
    expect(gateViewerWrite(subject(), false)).toBe(false);
    expect(gateViewerWrite(null, true)).toBe(true); // subject 없으면 뷰어 아님 → allowed 통과
  });

  test('B3: role-string predicate 결과 감싸기 — 뷰어면 canEditCustomer 결과 무력화', () => {
    // 코디는 원래 수정 권한 O(canEditCustomer=true) 지만 뷰어전용이면 차단.
    const viewerCody = { role: 'coordinator' as const, read_only: true };
    expect(canEditCustomer('coordinator')).toBe(true);
    expect(gateViewerWrite(viewerCody, canEditCustomer(viewerCody.role))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. subject-accepting write predicate 단락 (의료 포함 · uniform · carve-out 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C. write predicate 뷰어 단락 (uniform)', () => {
  test('C1: 진료관리 수정(canEditClinicMgmt) — 뷰어면 차단(원래 통과하던 director/admin도)', () => {
    expect(canEditClinicMgmt(subject({ role: 'director' }))).toBe(true); // baseline
    expect(canEditClinicMgmt(subject({ role: 'director', read_only: true }))).toBe(false);
    expect(canEditClinicMgmt(subject({ role: 'admin', read_only: true }))).toBe(false);
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: true, read_only: true })).toBe(false);
  });

  test('C2: 일마감 확정수정(canEditConfirmedClosing) — 뷰어면 차단', () => {
    expect(canEditConfirmedClosing(subject({ role: 'manager' }))).toBe(true);
    expect(canEditConfirmedClosing(subject({ role: 'manager', read_only: true }))).toBe(false);
    expect(canEditConfirmedClosing({ role: 'admin', has_ops_authority: true, read_only: true })).toBe(false);
  });

  test('C3: ★의료 write★ 경과분석지 발행(canIssueProgressDocs) — 뷰어면 차단 (medical carve-out 없음)', () => {
    expect(canIssueProgressDocs(subject({ role: 'director' }))).toBe(true);
    expect(canIssueProgressDocs(subject({ role: 'director', read_only: true }))).toBe(false);
    expect(canIssueProgressDocs(subject({ role: 'admin', read_only: true }))).toBe(false);
  });

  test('C4: 열람(canAccess 메뉴 접근)에는 영향 없음 — 뷰어도 메뉴/목록 열람 가능', () => {
    // read_only 는 write 만 막고 canAccess(운영메뉴)에는 개입하지 않음.
    expect(canAccess(subject({ role: 'director', read_only: true }), 'customers')).toBe(true);
    expect(canAccess(subject({ role: 'director', read_only: true }), 'dashboard')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. inert 불변식 — read_only flag 부재 시 기존 predicate 완전 무회귀
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D. inert 불변식 (flag 부재 = 0 behavior change)', () => {
  test('D1: read_only 미지정 시 write predicate 는 기존 role 판정 그대로', () => {
    // flag 없는 subject == role 문자열 판정과 동치.
    for (const role of ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'] as const) {
      expect(canEditClinicMgmt(subject({ role }))).toBe(canEditClinicMgmt(role));
      expect(canEditConfirmedClosing(subject({ role }))).toBe(canEditConfirmedClosing(role));
      expect(canIssueProgressDocs(subject({ role }))).toBe(canIssueProgressDocs(role));
    }
  });

  test('D2: role-string 호출부(subject 미보유) — read_only 축 미개입(하위호환)', () => {
    // 문자열만 넘기면 flag 를 볼 수 없음 → 기존 동작 100% 보존.
    expect(canEditClinicMgmt('director')).toBe(true);
    expect(canIssueProgressDocs('admin')).toBe(true);
    expect(canRequestOpinionDoc('coordinator')).toBe(true);
  });

  test('D3: hasOpsAuthority 등 read predicate 는 read_only 축과 직교(무영향)', () => {
    expect(hasOpsAuthority({ role: 'admin', read_only: true })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. 정적 소스 가드 — 훅 배선 · DDL_DIFF_HOLD · 실계정 생성 미포함
// ─────────────────────────────────────────────────────────────────────────────
test.describe('E. 소스 구조 가드', () => {
  test('E1: useReadOnly 훅이 ★Option B★ session.app_metadata.read_only 단일 소스 (user_profiles 컬럼 아님)', () => {
    const h = read('src/hooks/useReadOnly.ts');
    expect(h).toContain("import { useAuth } from '../lib/auth'");
    expect(h).toContain('isReadOnlyFromAppMetadata');
    expect(h).toContain('export function useReadOnly()');
    // Option B: session.user.app_metadata 에서 읽는다(profile.read_only 컬럼 참조 금지).
    expect(h).toContain('session?.user?.app_metadata');
    const hs = stripComments(h);
    expect(hs).not.toContain('profile.read_only');
    expect(hs).not.toContain('isViewerOnly(profile)');
  });

  test('E2: permissions.ts — isViewerOnly/gateViewerWrite 초크포인트 export + 3 predicate 단락', () => {
    const p = read('src/lib/permissions.ts');
    expect(p).toContain('export function isViewerOnly');
    expect(p).toContain('export function gateViewerWrite');
    // 3 subject-accepting write predicate 에 isViewerOnly 단락 삽입.
    expect((p.match(/if \(isViewerOnly\(s\)\) return false;/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test('E3: ★Option B (db_change=FALSE)★ — user_profiles.read_only 컬럼 미도입(Option A REJECT) · 마이그 미동반', () => {
    // 저장위치 = app_metadata(JWT claim). UserProfile 에 read_only 컬럼 필드를 추가하지 않는다(Option A=db_change:true REJECT).
    const t = stripComments(read('src/lib/types.ts'));
    const up = t.slice(t.indexOf('export interface UserProfile'), t.indexOf('export interface UserProfile') + 900);
    expect(up).not.toContain('read_only'); // UserProfile 실코드에 read_only 필드 부재(Option B)
    // 본 브랜치 diff 에 신규 마이그 파일 없음은 배포전 게이트(db_change=false)에서 확인 — 여기선 소스 축만 단언.
  });

  test('E4: uniform 원칙 명문화 — medical carve-out 부재(의료 write 도 동일 단락)', () => {
    const p = read('src/lib/permissions.ts');
    expect(p).toContain('carve-out');
    // canIssueProgressDocs(의료 write) 블록에 단락이 존재해야 함.
    const idx = p.indexOf('export function canIssueProgressDocs');
    const block = p.slice(idx, idx + 700);
    expect(block).toContain('if (isViewerOnly(s)) return false;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. 브라우저 회귀 가드 — 앱 로드(HTTP 200)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('F. 브라우저 회귀 가드', () => {
  test('F1: 앱 진입 HTTP 200 (번들 무붕괴)', async ({ page }) => {
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (실 뷰어계정 = 계정 LIVE 활성화 後 = HOLD 대상) ─────────
 *   ※ 아래는 read_only=true flag 가 부여된 origin@ 계정이 LIVE 된 뒤 검증할 항목.
 *     현재(FE-1차)는 flag 미부여 = inert 라 자동화 불가 → 활성화 게이트(문원장 컨펌 + 김주연 identity) 통과 후 수행.
 * 시나리오 A (뷰어전용 — 비의료 surface):
 *   [ ] 뷰어 계정 로그인 → 고객/예약/결제/일마감/직원·공간/서비스항목 메뉴·목록·상세 '열람' 가능
 *   [ ] 위 surface 의 저장/추가/삭제/수정 버튼 = 비활성 또는 숨김(write 액션 0)
 * 시나리오 B (뷰어전용 — 의료 surface, uniform):
 *   [ ] 진료대시보드/진료관리 열람 가능하되 경과분석지 발행·소견서 발행/취소·차트 편집 = 차단
 * 시나리오 C (기존 계정 무회귀 — scenario3):
 *   [ ] 기존 운영 계정(admin/manager/director/코디/치료사)은 write 동선 100% 종전과 동일(0 변화)
 * ── HOLD(본 티켓 미포함, planner 소유) ──────────────────────────────────────────────
 *   · 문원장(U0ALGAAAJAV) medical 컨펌 → origin@ 계정 LIVE 활성화(진료 PHI 열람) GO.
 *   · 김주연 총괄(U0ATDB587PV) identity(email/표시이름) 확인 → 실제 계정 provisioning GO.
 *   · user_profiles.read_only 컬럼 DDL = DA CONSULT 동반 landing(활성화 시점).
 */
