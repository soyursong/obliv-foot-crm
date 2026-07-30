/**
 * E2E spec — T-20260730-foot-ASSIGN-CONFIRM-EF-NON2XX-COORD-DIAG (P0 진단+핫픽스)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, 스샷 F0BLL6FPNEP):
 *   코디네이터 role 계정으로 '상담·치료사 배정' > [확정] 클릭 시
 *   "Edge Function returned a non-2xx status code" 팝업 → 배정 업무 중단.
 *   관리자/총괄 계정은 미발생.
 *
 * ── 진단 확정(H2, 로그/코드/DB 실증) ──
 *   근본원인 = FE↔EF authorization drift.
 *   - 34a11ce2 (T-20260729-foot-CONFIRM-BTN-ROLE-OPEN, 총괄 지시 '접근제어 완화')가 FE [확정] 버튼
 *     role gate(canEditDistribution=admin/manager/director)를 제거 → 코디네이터 포함 전 역할 표시+클릭 가능.
 *     (prod FE commit 90b3605 는 34a11ce2 를 포함 — git ancestry 검증)
 *   - 그러나 send-consult-notify EF 는 구 allowlist(admin/manager/director) 유지 → verifyRoleJwt 가
 *     coordinator 를 거부하고 403 반환 → supabase-js functions.invoke 가 "non-2xx status code" 표면화.
 *   - prod user_profiles 에 coordinator 8건 실재 → 결정적 403. admin(13)/manager(3)/director(2) 통과 → 무에러.
 *     ⇒ 현장 증상(coordinator 실패 / 관리자·총괄 정상)과 정확히 일치.
 *   - H1(RLS) 배제: EF 는 service_role client 로 check_ins write → RLS 우회. 403 은 app-layer allowlist.
 *
 * ── fix ──
 *   EF CONFIRM_ALLOWED_ROLES 를 FE ROLE-OPEN 결정(이미 총괄 승인)과 동기화 = cross_crm_data_contract
 *   staff role 8종 전체 허용. 유효 role guard 유지(null/잡값 거부), 클리닉 격리(callerBelongsToClinic) 불변.
 *   db_change=false — RLS/GRANT/DDL 무변경, EF app-layer only.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(coordinator 로그인→[확정]→발송 성공)는 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const EF = 'supabase/functions/send-consult-notify/index.ts';
const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: EF allowlist 가 coordinator(및 8종 staff role)를 포함 — FE ROLE-OPEN 패리티
// ─────────────────────────────────────────────────────────────────────────────
test('fix: EF CONFIRM_ALLOWED_ROLES 에 coordinator 포함(403 회귀 방지)', () => {
  const src = read(EF);
  const m = src.match(/const CONFIRM_ALLOWED_ROLES\s*=\s*\[([\s\S]*?)\]/);
  expect(m).not.toBeNull();
  const list = m![1];
  for (const role of [
    'admin', 'manager', 'director', 'coordinator', 'consultant', 'therapist', 'staff', 'tm',
  ]) {
    expect(list).toContain(`"${role}"`);
  }
});

test('fix: EF 는 여전히 유효 role guard(verifyRoleJwt) 로 null/잡값 role 을 거부', () => {
  const src = read(EF);
  // allowlist 미포함 시 403 반환 경로 유지 — allowlist 를 없애 전면개방한 것이 아님.
  expect(src).toMatch(/verifyRoleJwt\(jwt, CONFIRM_ALLOWED_ROLES\)/);
  expect(src).toMatch(/return json\(\{ error: `Unauthorized[^`]*` \}, 403\)/);
});

test('안전 불변: 클리닉 격리(callerBelongsToClinic) 는 유지(테넌트 안전 불변)', () => {
  const src = read(EF);
  expect(src).toMatch(/callerBelongsToClinic\(userId, clinicId\)/);
  expect(src).toContain('clinic 소속 불일치');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: RED LINE INV-1 — 발송상태 컬럼만 write, 매출귀속 무접촉 (fix 로 훼손 없음)
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE INV-1: claim UPDATE 는 consult_notify_* 만 write, consultant_id/assigned_consultant_id 무접촉', () => {
  const src = read(EF);
  const claim = src.slice(src.indexOf('.update({\n      consult_notify_status: "sending"'));
  expect(claim).not.toContain('assigned_consultant_id');
  // claim SET 절에 consultant_id/therapist_id 배정 포인터 write 금지
  expect(src).not.toMatch(/\.update\(\{[^}]*consultant_id:\s/);
  expect(src).not.toMatch(/\.update\(\{[^}]*therapist_id:\s/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: FE ROLE-OPEN 계약 — [확정] 버튼은 role gate 없이 노출(회귀 방지)
// ─────────────────────────────────────────────────────────────────────────────
test('FE 계약: [확정] 버튼은 canEditDistribution gate 밖(전 역할 노출)', () => {
  const src = read(PAGE);
  // 발송(확정) 셀 블록에 ROLE-OPEN 근거 주석 + 버튼 testid 존재
  expect(src).toContain('CONFIRM-BTN-ROLE-OPEN');
  expect(src).toMatch(/data-testid=\{`dist-confirm-btn-\$\{r\.id\}`\}/);
});
