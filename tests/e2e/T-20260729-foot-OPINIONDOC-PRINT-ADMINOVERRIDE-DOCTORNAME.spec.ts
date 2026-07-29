/**
 * E2E Spec — T-20260729-foot-OPINIONDOC-PRINT-ADMINOVERRIDE-DOCTORNAME  [P0 / hotfix]
 *
 * 현장(김주연 총괄, 조재훈 F-5055): '행정정보'에서 담당의 문지은→한동훈 변경·저장했으나, 소견서 탭
 *   '출력(print)' 시 여전히 '문지은'으로 표출. 화면 열람(IssuedOpinionDocFormView)만 정상(한동훈).
 *
 * Root Cause (responder 코드 확인):
 *   · '행정정보 수정'(useUpdateOpinionAdminFields)은 담당의 정정을 발행본(status='published')이 아니라
 *     그 발행을 만든 '요청행'(status='voided'+resolved_reason='published') field_data.admin_overrides 에 저장
 *     (발행본 불변, T-20260724 PERMSPLIT / T-20260728 AC-6 doctor_id 앵커).
 *   · OpinionDocTab.handlePrint 는 발행본(published) 스냅샷 field_data.doctor_name(=issued_by_name)만 읽어
 *     오버레이를 무시 → 출력물에 발행 당시 이름(문지은)이 그대로 인쇄됨. ★단일 근원.
 *   · 데스크/수납 출력 경로(medDocPrintGate)는 별건(T-20260729-STALE)에서 이미 오버레이 반영 — 본 티켓은
 *     의사 소견서 탭(OpinionDocTab)의 출력 버튼 경로를 동형으로 재배선.
 *
 * Fix (db_change=false, 무DDL — 기존 JSONB admin_overrides 재사용, 단일 파일 OpinionDocTab.tsx):
 *   · AC-1: PublishedOpinionRow 에 adminOverrides?: AdminFieldOverrides 추가 + parseAdminOverrides/
 *           AdminFieldOverrides(opinionRequest) + resolveAdminOverrideForDoc/AdminOverrideCandidate
 *           (medDocPrintGate, 데스크 경로와 동일 순수 헬퍼 재사용 → 매칭 drift 방지) import.
 *   · AC-2: usePublishedOpinions 가 voided(resolved_reason='published') 요청행 admin_overrides 를 조회해
 *           doc_type+check_in_id 로 발행본에 매칭·주입(resolveAdminOverrideForDoc).
 *   · AC-3: handlePrint 가 effectiveDoctorName(=override||issued_by_name)·effectiveDoctorId(=override??
 *           issued_by_doctor_id)로 결선 — issuedByName override + 도장 앵커(SEAL-DOCTOR-MATCH 세트 정합).
 *           null-safe: 미정정/부분정정 시 발행본 스냅샷 유지(회귀 0).
 *   · issue_date/diag_code override 는 본 티켓 스코프 밖(SHARED-SURFACE DIAGCODE-BLANK/OVERFLOW-2PAGE
 *     손상 방지) — issued_at·check_in_services 종전 소스 유지.
 *
 * 실행: npx playwright test --project=unit T-20260729-foot-OPINIONDOC-PRINT-ADMINOVERRIDE-DOCTORNAME.spec.ts
 * NOTE: 라이브 렌더 실측(조재훈 F-5055 출력에 '한동훈' 표출, AC-4)은 supervisor QA + post-deploy 조재훈
 *       라이브 confirm(§11 진료화면 법정성, medical_confirm_gate.post_deploy_confirm). 여기선 배선 계약
 *       (정적 소스 가드) + 매칭/override 규칙(순수 로직) 단언.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveAdminOverrideForDoc,
  type AdminOverrideCandidate,
} from '@/lib/medDocPrintGate';
import type { AdminFieldOverrides } from '@/lib/opinionRequest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAB_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/doctor/OpinionDocTab.tsx'),
  'utf-8',
);

// ── AC-1: import + 인터페이스 배선 가드 (정적 소스) ────────────────────────────
test.describe('AC-1: OpinionDocTab 이 오버레이 타입·헬퍼를 배선', () => {
  test('parseAdminOverrides + AdminFieldOverrides(opinionRequest) import', () => {
    expect(TAB_SRC).toMatch(
      /import\s*\{[^}]*parseAdminOverrides[^}]*type\s+AdminFieldOverrides[^}]*\}\s*from\s*'@\/lib\/opinionRequest'/,
    );
  });

  test('resolveAdminOverrideForDoc + AdminOverrideCandidate(medDocPrintGate) 재사용 import', () => {
    expect(TAB_SRC).toMatch(
      /import\s*\{[^}]*resolveAdminOverrideForDoc[^}]*type\s+AdminOverrideCandidate[^}]*\}\s*from\s*'@\/lib\/medDocPrintGate'/,
    );
  });

  test('PublishedOpinionRow 에 adminOverrides?: AdminFieldOverrides 추가', () => {
    expect(TAB_SRC).toMatch(/adminOverrides\?:\s*AdminFieldOverrides;/);
  });
});

// ── AC-2: usePublishedOpinions 오버레이 조회·매칭 배선 가드 ─────────────────────
test.describe('AC-2: usePublishedOpinions 가 요청행 오버레이를 발행본에 주입', () => {
  test('voided(status) 요청행 조회 + staff_consult + resolved_reason=published 필터', () => {
    expect(TAB_SRC).toMatch(/\.eq\('status',\s*'voided'\)/);
    expect(TAB_SRC).toMatch(/rfd\['request_origin'\]\s*!==\s*'staff_consult'/);
    expect(TAB_SRC).toMatch(/rfd\['resolved_reason'\]\s*!==\s*'published'/);
    expect(TAB_SRC).toMatch(/parseAdminOverrides\(rfd\)/);
  });

  test('요청행 top-level check_in_id 를 매칭 키로 후보 구성', () => {
    expect(TAB_SRC).toMatch(/\.select\('check_in_id,\s*field_data,\s*created_at'\)/);
    expect(TAB_SRC).toMatch(/checkInId:\s*\(rr\['check_in_id'\][^)]*\)\s*\?\?\s*null/);
  });

  test('resolveAdminOverrideForDoc(doc_type, check_in_id) 로 매칭 후 발행본에 주입', () => {
    expect(TAB_SRC).toMatch(/resolveAdminOverrideForDoc\(row\.doc_type,\s*row\.check_in_id,\s*candidates\)/);
    expect(TAB_SRC).toMatch(/row\.adminOverrides\s*=\s*ov/);
  });

  test('조회 실패는 조용히 폴백(발행본 스냅샷 출력, 회귀 0)', () => {
    expect(TAB_SRC).toMatch(/admin_overrides 로드 실패 — 발행본 스냅샷으로 출력/);
  });
});

// ── AC-3: handlePrint effective 결선 배선 가드 ─────────────────────────────────
test.describe('AC-3: handlePrint 가 정정 담당의·도장을 override 로 결선', () => {
  test('effectiveDoctorName = override.doctorName || issued_by_name (null-safe 폴백)', () => {
    expect(TAB_SRC).toMatch(
      /effectiveDoctorName\s*=\s*row\.adminOverrides\?\.doctorName\s*\|\|\s*row\.issued_by_name/,
    );
  });

  test('effectiveDoctorId = override.doctorId ?? issued_by_doctor_id (도장 세트 정합)', () => {
    expect(TAB_SRC).toMatch(
      /effectiveDoctorId\s*=\s*row\.adminOverrides\?\.doctorId\s*\?\?\s*row\.issued_by_doctor_id/,
    );
  });

  test('loadAutoBindContext·printOpinionDoc 에 effective 값이 전달(발행 스냅샷 직접참조 제거)', () => {
    expect(TAB_SRC).toMatch(
      /loadAutoBindContext\(\s*checkIn,\s*effectiveDoctorName\s*\|\|\s*undefined,\s*effectiveDoctorId\s*\?\?\s*undefined,?\s*\)/,
    );
    expect(TAB_SRC).toMatch(/issuedByName:\s*effectiveDoctorName/);
    // 회귀 가드: print payload 가 더 이상 발행 스냅샷 이름/도장 원본을 직접 태우지 않는다.
    expect(TAB_SRC).not.toMatch(/issuedByName:\s*row\.issued_by_name/);
  });

  test('SHARED-SURFACE 무회귀: diag_code(applyDiagCodesFromVisit)·customer_phone 실값 로직 보존', () => {
    // T-20260721 DIAGCODE-BLANK / T-20260724 OVERFLOW-2PAGE — 상병 소스 불변
    expect(TAB_SRC).toMatch(/applyDiagCodesFromVisit\(autoValues,\s*diagCheckIn\)/);
    // T-20260720 PRINT-4FIX FIX-② — check_ins.customer_phone 실값 주입 불변
    expect(TAB_SRC).toMatch(/customer_phone:\s*visitor\.customer_phone\s*\?\?\s*null/);
  });
});

// ── 매칭 규칙 재현 (resolveAdminOverrideForDoc 직접 import) ──────────────────────
const ov = (o: Partial<AdminFieldOverrides>): AdminFieldOverrides => o as AdminFieldOverrides;

test.describe('resolveAdminOverrideForDoc: 발행본 ↔ 요청행 오버레이 매칭', () => {
  test('같은 doc_type + check_in_id 일치 → 그 오버레이 채택 (F-5055 재현)', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'opinion', checkInId: 'ci-5055', overrides: ov({ doctorName: '한동훈', doctorId: 'cd-han' }) },
      { docType: 'opinion', checkInId: 'ci-2', overrides: ov({ doctorName: '다른' }) },
    ];
    const r = resolveAdminOverrideForDoc('opinion', 'ci-5055', cands);
    expect(r?.doctorName).toBe('한동훈');
    expect(r?.doctorId).toBe('cd-han');
  });

  test('발행본 check_in 있으나 일치 후보 없음 → undefined(타 방문 정정 오적용 차단)', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'opinion', checkInId: 'ci-OTHER', overrides: ov({ doctorName: '오적용금지' }) },
    ];
    expect(resolveAdminOverrideForDoc('opinion', 'ci-5055', cands)).toBeUndefined();
  });

  test('doc_type 불일치 후보 무시(소견서 ↔ 진단서 교차 금지)', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'diagnosis', checkInId: 'ci-5055', overrides: ov({ doctorName: '진단서정정' }) },
    ];
    expect(resolveAdminOverrideForDoc('opinion', 'ci-5055', cands)).toBeUndefined();
  });

  test('후보 없음 → undefined(정정 없음 = 발행본 스냅샷 그대로, 회귀 0)', () => {
    expect(resolveAdminOverrideForDoc('opinion', 'ci-5055', [])).toBeUndefined();
  });
});

// ── override 우선순위 재현: handlePrint effective 계층 동형 (현장 클릭 시나리오 3종) ──
function effectiveDoctor(
  o: AdminFieldOverrides | undefined,
  issuedByName: string,
  issuedByDoctorId: string | null,
): { name: string; id: string | undefined } {
  return {
    // OpinionDocTab.handlePrint effectiveDoctorName/effectiveDoctorId 규칙과 동형.
    name: o?.doctorName || issuedByName,
    id: o?.doctorId ?? issuedByDoctorId ?? undefined,
  };
}

test.describe('현장 시나리오: 정정 담당의·도장이 발행 스냅샷을 이긴다', () => {
  test('시나리오1(정상 재현) — 정정 있음 → 이름·도장 모두 정정 진료의(한동훈/cd-han, AC-4)', () => {
    const e = effectiveDoctor(ov({ doctorName: '한동훈', doctorId: 'cd-han' }), '문지은', 'cd-moon');
    expect(e.name).toBe('한동훈'); // 출력물 담당의 = 한동훈 (문지은 아님)
    expect(e.id).toBe('cd-han');   // 도장도 정정 진료의 → 이름↔도장 세트 정합
  });

  test('시나리오2(override 없는 기존 발행분) — 발행 스냅샷 유지(문지은/cd-moon, AC-5 회귀 0)', () => {
    const e = effectiveDoctor(undefined, '문지은', 'cd-moon');
    expect(e.name).toBe('문지은');
    expect(e.id).toBe('cd-moon');
  });

  test('시나리오3(부분 override) — 이름만 정정(레거시 id 부재) → 이름 정정, 도장 발행자 폴백(null-safe)', () => {
    const e = effectiveDoctor(ov({ doctorName: '한동훈' }), '문지은', 'cd-moon');
    expect(e.name).toBe('한동훈');
    expect(e.id).toBe('cd-moon');
  });

  test('빈 문자열 override 는 폴백(parseAdminOverrides 가 빈값 미주입 → 방어)', () => {
    const e = effectiveDoctor(ov({ doctorName: '' }), '문지은', 'cd-moon');
    expect(e.name).toBe('문지은');
  });
});
