/**
 * E2E Spec — T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE  [P0 / hotfix]
 *
 * 현장(김주연 총괄, 조재훈 F-5055): '행정정보'에서 담당의 문지은→한동훈 변경·저장했으나, 2번차트 소견서를
 *   데스크에서 '출력'하면 여전히 '문지은 원장'으로 표출(법정성 서류 즉시 출력 대기).
 *
 * Root Cause (audit-first):
 *   · '행정정보 수정'(useUpdateOpinionAdminFields)은 담당의 정정을 발행본(status='published')이 아니라
 *     그 발행을 만든 '요청행'(status='voided'+resolved_reason='published') field_data.admin_overrides 에 저장한다
 *     (발행본 불변, T-20260724 PERMSPLIT / T-20260728 AC-6 doctor_id 앵커).
 *   · 화면 열람(IssuedOpinionDocFormView)은 이 오버레이를 얹어 정정 담당의(한동훈)·도장을 보여준다.
 *   · 그러나 데스크/수납 출력 경로(useAuthoredMedDocs → printAuthoredMedDoc → printOpinionDoc)는 발행본
 *     스냅샷만 읽어(issuedByName=field_data.doctor_name, 도장=issued_by_doctor_id) 오버레이를 무시 →
 *     정정 담당의가 '출력'에 반영되지 않고 발행 당시 이름(문지은)이 그대로 인쇄됨. ★단일 근원.
 *
 * Fix (db_change=false, 무DDL — 기존 JSONB admin_overrides 재사용):
 *   · AC-1: useAuthoredMedDocs 가 요청행 admin_overrides 를 발행본에 매칭(check_in_id + doc_type)해 attach.
 *           printAuthoredMedDoc 이 doctorName→issuedByName override(소견서 {{doctor_name}} + 진단서
 *           {{attending_doctor_name}} 동시 지배, renderOpinionDocHtml 규칙 재사용).
 *   · AC-2: doctorId 오버레이 → 도장 앵커(effectiveDoctorId) 지배 → 이름↔도장 세트 정합(SEAL-DOCTOR-MATCH
 *           동형, seal 재구현 0 — loadAutoBindContext(effectiveName, effectiveId) 로 자동추종).
 *   · AC-3: useUpdateOpinionAdminFields.onSuccess 가 ['meddoc_authored', clinicId] 무효화 → 저장 직후
 *           새로고침 없이 출력에 반영.
 *   · 정정 없음(오버레이 미존재) → 종전 발행본 스냅샷 그대로 출력(회귀 0).
 *
 * 실행: npx playwright test --project=unit T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE.spec.ts
 * NOTE: 라이브 렌더 실측(조재훈 F-5055, 출력에 한동훈·도장 표출)은 supervisor QA + post-deploy 조재훈 라이브
 *       confirm(§11 진료화면 법정성). 여기선 배선 계약(정적 소스 가드) + 매칭/override 규칙(순수 로직) 단언.
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
const GATE_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/medDocPrintGate.ts'), 'utf-8');
const REQ_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/opinionRequest.ts'), 'utf-8');

// ── 배선 가드 (정적 소스) ─────────────────────────────────────────────────────
test.describe('배선: 데스크 출력 경로가 행정정보 오버레이를 읽는다', () => {
  test('medDocPrintGate 가 parseAdminOverrides/AdminFieldOverrides 를 import', () => {
    expect(GATE_SRC).toMatch(/import\s*\{\s*parseAdminOverrides,\s*type\s+AdminFieldOverrides\s*\}\s*from\s*'@\/lib\/opinionRequest'/);
  });

  test('AuthoredMedDoc 에 adminOverrides 필드 추가', () => {
    expect(GATE_SRC).toMatch(/adminOverrides\?:\s*AdminFieldOverrides;/);
  });

  test('useAuthoredMedDocs 가 voided 요청행을 조회해 오버레이 후보를 만든다', () => {
    // published 조회에 top-level check_in_id 를 읽어 매칭 키로 사용
    expect(GATE_SRC).toMatch(/\.select\('id,\s*check_in_id,\s*field_data,\s*created_at'\)/);
    // voided 요청행 조회 + staff_consult + resolved_reason='published' + parseAdminOverrides
    expect(GATE_SRC).toMatch(/\.eq\('status',\s*'voided'\)/);
    expect(GATE_SRC).toMatch(/fd\['request_origin'\]\s*!==\s*'staff_consult'/);
    expect(GATE_SRC).toMatch(/fd\['resolved_reason'\]\s*!==\s*'published'/);
    expect(GATE_SRC).toMatch(/parseAdminOverrides\(fd\)/);
    // 매칭 후 attach
    expect(GATE_SRC).toMatch(/resolveAdminOverrideForDoc\(/);
    expect(GATE_SRC).toMatch(/byType\[docType\]!\.adminOverrides\s*=\s*ov/);
  });

  test('printAuthoredMedDoc 가 정정 담당의·도장을 override 로 결선(effectiveDoctorName/Id)', () => {
    expect(GATE_SRC).toMatch(/effectiveDoctorName\s*=\s*ov\?\.doctorName\s*\|\|\s*doc\.issuedByName/);
    expect(GATE_SRC).toMatch(/effectiveDoctorId\s*=\s*ov\?\.doctorId\s*\?\?\s*doc\.issuedByDoctorId/);
    // 도장은 loadAutoBindContext 에 effective 값을 태워 자동추종(seal 재구현 0)
    expect(GATE_SRC).toMatch(/loadAutoBindContext\(\s*ctx\.checkIn,\s*effectiveDoctorName\s*\|\|\s*undefined,\s*effectiveDoctorId,?\s*\)/);
    // printOpinionDoc 에는 effective 담당의명이 issuedByName 으로 전달
    expect(GATE_SRC).toMatch(/issuedByName:\s*effectiveDoctorName/);
    // renderOpinionDocHtml/printOpinionDoc 은 도장을 재구성하지 않는다(SEAL 재구현 금지 — 회귀 가드)
    expect(GATE_SRC).not.toMatch(/doctor_seal_html/);
  });

  test('발급일·상병코드 오버레이도 열람 경로와 동형으로 override', () => {
    expect(GATE_SRC).toMatch(/effectiveIssueDate\s*=\s*ov\?\.issueDate\s*\|\|/);
    expect(GATE_SRC).toMatch(/ov\?\.diagCode\s*\?/);
    expect(GATE_SRC).toMatch(/issueDate:\s*effectiveIssueDate/);
    expect(GATE_SRC).toMatch(/diagCodes:\s*effectiveDiagCodes/);
  });

  test('AC-3: 담당의 정정 저장 시 데스크 출력 게이트 캐시(meddoc_authored) 무효화', () => {
    expect(REQ_SRC).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['meddoc_authored',\s*clinicId\]\s*\}\)/);
  });
});

// ── 매칭 규칙 재현 (resolveAdminOverrideForDoc 직접 import) ──────────────────────
const ov = (o: Partial<AdminFieldOverrides>): AdminFieldOverrides => o as AdminFieldOverrides;

test.describe('resolveAdminOverrideForDoc: 발행본 ↔ 요청행 오버레이 매칭', () => {
  test('같은 doc_type + check_in_id 일치 → 그 오버레이 채택', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'opinion', checkInId: 'ci-1', overrides: ov({ doctorName: '한동훈', doctorId: 'cd-han' }) },
      { docType: 'opinion', checkInId: 'ci-2', overrides: ov({ doctorName: '다른' }) },
    ];
    const r = resolveAdminOverrideForDoc('opinion', 'ci-1', cands);
    expect(r?.doctorName).toBe('한동훈');
    expect(r?.doctorId).toBe('cd-han');
  });

  test('발행본 check_in 있으나 일치 후보 없음 → undefined(타 방문 정정 오적용 차단)', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'opinion', checkInId: 'ci-OTHER', overrides: ov({ doctorName: '오적용금지' }) },
    ];
    expect(resolveAdminOverrideForDoc('opinion', 'ci-1', cands)).toBeUndefined();
  });

  test('doc_type 불일치 후보는 무시(소견서 ↔ 진단서 교차 금지)', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'diagnosis', checkInId: 'ci-1', overrides: ov({ doctorName: '진단서정정' }) },
    ];
    expect(resolveAdminOverrideForDoc('opinion', 'ci-1', cands)).toBeUndefined();
  });

  test('레거시(발행본 check_in 미상) → 같은 doc_type 최신 오버레이 폴백(candidates=created_at desc)', () => {
    const cands: AdminOverrideCandidate[] = [
      { docType: 'opinion', checkInId: null, overrides: ov({ doctorName: '최신' }) },
      { docType: 'opinion', checkInId: null, overrides: ov({ doctorName: '과거' }) },
    ];
    expect(resolveAdminOverrideForDoc('opinion', null, cands)?.doctorName).toBe('최신');
  });

  test('후보 없음 → undefined(정정 없음 = 발행본 스냅샷 그대로, 회귀 0)', () => {
    expect(resolveAdminOverrideForDoc('opinion', 'ci-1', [])).toBeUndefined();
  });
});

// ── override 우선순위 재현 (printAuthoredMedDoc effective 값 계층 동형) ──────────
// medDocPrintGate.ts effectiveDoctorName/effectiveDoctorId 규칙과 동형.
function effectiveDoctor(
  o: AdminFieldOverrides | undefined,
  issuedByName: string,
  issuedByDoctorId: string | null,
): { name: string; id: string | undefined } {
  return {
    name: o?.doctorName || issuedByName,
    id: o?.doctorId ?? issuedByDoctorId ?? undefined,
  };
}

test.describe('override 우선순위: 정정 담당의·도장이 발행 스냅샷을 이긴다', () => {
  test('정정 있음 → 이름·도장 모두 정정 진료의(한동훈/cd-han)', () => {
    const e = effectiveDoctor(ov({ doctorName: '한동훈', doctorId: 'cd-han' }), '문지은', 'cd-moon');
    expect(e.name).toBe('한동훈'); // 소견서/진단서 명의 모두 지배
    expect(e.id).toBe('cd-han');   // 도장 앵커도 정정 진료의 → 이름↔도장 세트 정합(AC-2)
  });

  test('정정 없음 → 발행 스냅샷 유지(문지은/cd-moon, 회귀 0)', () => {
    const e = effectiveDoctor(undefined, '문지은', 'cd-moon');
    expect(e.name).toBe('문지은');
    expect(e.id).toBe('cd-moon');
  });

  test('이름만 정정(레거시 id 부재) → 이름은 정정, 도장은 발행자 폴백', () => {
    const e = effectiveDoctor(ov({ doctorName: '한동훈' }), '문지은', 'cd-moon');
    expect(e.name).toBe('한동훈');
    expect(e.id).toBe('cd-moon');
  });
});
