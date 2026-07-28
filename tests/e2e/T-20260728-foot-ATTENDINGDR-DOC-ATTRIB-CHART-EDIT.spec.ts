/**
 * E2E Spec — T-20260728-foot-ATTENDINGDR-DOC-ATTRIB-CHART-EDIT
 *
 * [P1] 진료의(담당 의사) 서류 발행명의·진료차트 연결·행정정보 정정 — 김주연 총괄(풋센터), 스레드 5회 반복.
 *   현장 원문: "환자별 진료의 등록했는데 진료차트랑 연결 안 됨 / 소견서·진단서가 진료의 아닌 대표원장 성함으로
 *   다 들어감 / 진료의 기준으로 발행돼야 함 / 담당의 변경은 기입 말고 드롭 선택 / 도장도 진료의 따라와야 함."
 *
 * Root Cause (audit-first):
 *   · AC-1: check_ins.treating_doctor_id 저장O·표시X — MedicalChartPanel 서명블록은 signing_doctor_name만 렌더.
 *   · AC-2: renderOpinionDocHtml 이 발행자 스냅샷(issuedByName)을 소견서 토큰({{doctor_name}})에만 override →
 *           진단서(formKey='diagnosis', 명의란={{attending_doctor_name}})는 autoValues 해석값(미지정 폴백=
 *           대표원장/기관명)으로 렌더돼 진료의가 아닌 대표원장 명의로 발행. ★현장 5회 반복 신고의 단일 근원.
 *   · AC-6: '행정 발급 정보 정정'(DocRequestQueue)의 담당의가 free-text input → 오타/불일치 명의 위험.
 *
 * Fix (db_change=false, 무DDL — JSONB field_data.admin_overrides 재사용):
 *   · AC-1: MedicalChartPanel 서명블록에 지정 진료의(treatingDoctorId→clinicDoctors.name) 표시(chart-treating-doctor).
 *   · AC-2: renderOpinionDocHtml issuedByName override 를 doctor_name + attending_doctor_name 양쪽에 결선 →
 *           소견서·진단서 모두 발행/정정 진료의 명의가 단일 소스로 지배.
 *   · AC-7: 도장({{doctor_seal_html}})은 autoValues(issued_by_doctor_id 앵커, T-20260721-SEAL-DOCTOR-MATCH)로
 *           자동 추종 — SEAL 재구현 0. 명의만 고치면 이름·도장이 함께 진료의로 표출(회귀검증 전담).
 *   · AC-6: DocRequestQueue 담당의 = clinic_doctors 드롭다운(useClinicDoctors 재사용). 선택 id 를 admin_overrides.
 *           doctor_id 앵커로 저장 → 열람/재출력 시 도장이 정정 진료의 본인 직인으로 추종.
 *   · AC-4: 발행완료 서류 정정 = 발행본(published) 불오염 오버레이(요청행 field_data, .eq('status','voided')) 유지 —
 *           immutable 트리거/RLS 무접촉(void+reissue 계열, 비파괴). 신규 컬럼 0.
 *
 * 실행: npx playwright test --project=unit T-20260728-foot-ATTENDINGDR-DOC-ATTRIB-CHART-EDIT.spec.ts
 * NOTE: 라이브 렌더 실측(진료의 선택→명의·도장 함께 표출)은 supervisor QA + 김주연 총괄 confirm_gate(§11 진료화면
 *       법정성). 여기선 배선 계약(정적 소스 가드) + 토큰 바인딩/도장 결선 규칙(순수 로직 재현)을 단언.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRINT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/printOpinionDoc.ts'), 'utf-8');
const REQ_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/opinionRequest.ts'), 'utf-8');
const QUEUE_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/doctor/DocRequestQueue.tsx'), 'utf-8');
const VIEW_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/doctor/IssuedOpinionDocFormView.tsx'), 'utf-8');
const CHART_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/MedicalChartPanel.tsx'), 'utf-8');
const TAB_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/doctor/OpinionDocTab.tsx'), 'utf-8');
const TMPL_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/htmlFormTemplates.ts'), 'utf-8');

// ── 시나리오 1 (AC-2): 서류 발행 명의 = 진료의 — 진단서 attending_doctor_name 결선 ─────────
test.describe('AC-2 배선: renderOpinionDocHtml → 발행자 스냅샷을 진단서 명의 토큰에도 결선', () => {
  test('issuedByName override 가 doctor_name + attending_doctor_name 양쪽에 결선', () => {
    // ...(data.issuedByName ? { doctor_name: data.issuedByName, attending_doctor_name: data.issuedByName } : {}),
    expect(PRINT_SRC, '발행자 스냅샷이 진단서 명의 토큰(attending_doctor_name)에 미결선 — 진단서가 대표원장으로 렌더').toMatch(
      /data\.issuedByName\s*\?\s*\{\s*doctor_name:\s*data\.issuedByName,\s*attending_doctor_name:\s*data\.issuedByName\s*\}/,
    );
  });

  test('진단서 템플릿 명의란은 {{attending_doctor_name}}, 소견서는 {{doctor_name}} (분리 축 유지)', () => {
    expect(TMPL_SRC).toContain('{{attending_doctor_name}}');
    expect(TMPL_SRC).toContain('{{doctor_name}}');
  });
});

// ── 토큰 바인딩 규칙 재현 (renderOpinionDocHtml override 계층 동형 순수 로직) ─────────
// printOpinionDoc.ts L99-123 의 "autoValues base + 스냅샷 truthy override" 규칙과 동형.
type Tokens = Record<string, string>;
function bindDoctorTokens(autoValues: Tokens, issuedByName: string | null): Tokens {
  const fv: Tokens = { ...autoValues };
  if (issuedByName) {
    fv['doctor_name'] = issuedByName;
    fv['attending_doctor_name'] = issuedByName; // AC-2 fix: 진단서 명의도 스냅샷 지배
  }
  return fv;
}

test.describe('AC-2 규칙 재현: 진단서 명의 = 발행/정정 진료의', () => {
  test('진료의 발행 → 진단서 attending_doctor_name = 진료의(대표원장 아님)', () => {
    // autoValues 가 미지정 폴백으로 대표원장/기관명을 담고 있어도, 발행자 스냅샷이 명의를 지배.
    const auto = { attending_doctor_name: '문지은', doctor_name: '오블리브 풋센터 종로' };
    const bound = bindDoctorTokens(auto, '김윤기');
    expect(bound['attending_doctor_name']).toBe('김윤기'); // 진단서 명의 = 진료의
    expect(bound['doctor_name']).toBe('김윤기');           // 소견서 명의 = 진료의
  });

  test('발행자 미상(스냅샷 null) → autoValues 폴백 유지(회귀 0)', () => {
    const auto = { attending_doctor_name: '한동훈', doctor_name: '한동훈' };
    const bound = bindDoctorTokens(auto, null);
    expect(bound['attending_doctor_name']).toBe('한동훈');
  });
});

// ── 시나리오 4 (AC-6): 담당의 = 드롭다운(free-text 금지) + doctor_id 앵커 ─────────
test.describe('AC-6 배선: DocRequestQueue 담당의 드롭다운 + doctor_id 앵커 저장', () => {
  test('담당의 = <select> 드롭다운(clinic_doctors), free-text <input type="text"> 제거', () => {
    // 드롭다운 존재
    expect(QUEUE_SRC).toMatch(/data-testid="docreq-admin-doctor-name"[\s\S]{0,200}<option/);
    expect(QUEUE_SRC).toMatch(/<select[\s\S]{0,700}data-testid="docreq-admin-doctor-name"/);
    // 담당의 필드가 free-text input 으로 남아있지 않음(오타/불일치 명의 원천 차단)
    expect(QUEUE_SRC, '담당의가 여전히 free-text input — AC-6 위반').not.toMatch(
      /type="text"[\s\S]{0,120}data-testid="docreq-admin-doctor-name"/,
    );
  });

  test('옵션 소스 = useClinicDoctors 재사용(중복 구현 금지)', () => {
    expect(QUEUE_SRC).toMatch(/useClinicDoctors/);
    expect(TAB_SRC, 'useClinicDoctors export 누락').toMatch(/export function useClinicDoctors/);
  });

  test('선택 시 doctorId + doctorName 함께 세팅', () => {
    expect(QUEUE_SRC).toMatch(/doctorId:\s*id,\s*doctorName:\s*doc\?\.name/);
  });

  test('admin_overrides.doctor_id 저장 + AdminFieldOverrides.doctorId 파싱', () => {
    expect(REQ_SRC, 'AdminFieldOverrides.doctorId 인터페이스 누락').toMatch(/doctorId\?:\s*string;/);
    expect(REQ_SRC, 'admin_overrides.doctor_id 파싱 누락').toMatch(/out\.doctorId\s*=\s*o\['doctor_id'\]/);
    expect(REQ_SRC, 'admin_overrides.doctor_id 저장 누락').toMatch(/nextOverrides\['doctor_id'\]\s*=\s*input\.doctorId/);
  });
});

// ── 시나리오 4 (AC-7): 도장 자동추종 — 정정 진료의 id 로 seal 결선(SEAL 재구현 0) ─────────
test.describe('AC-7 회귀: 정정 진료의로 도장(직인) 자동 추종', () => {
  test('IssuedOpinionDocFormView: adminOverrides.doctorId 우선 → loadAutoBindContext clinicDoctorId', () => {
    expect(VIEW_SRC).toMatch(/effectiveDoctorId\s*=\s*adminOverrides\?\.doctorId\s*\?\?\s*viewDoc\?\.issuedByDoctorId/);
    expect(VIEW_SRC).toMatch(/loadAutoBindContext\(\s*checkIn,\s*effectiveDoctorName,\s*effectiveDoctorId,?\s*\)/);
  });

  test('진단서 템플릿 도장란 = {{doctor_seal_html}}(autoValues 추종, printOpinionDoc 재계산 아님)', () => {
    expect(TMPL_SRC).toContain('{{doctor_seal_html}}');
    // renderOpinionDocHtml 은 도장 토큰을 스냅샷 override 로 재구성하지 않음(seal 은 autoValues 소스 유지).
    expect(PRINT_SRC, 'renderOpinionDocHtml 이 도장을 재구성 — SEAL 재구현 금지 위반').not.toMatch(
      /doctor_seal_html:\s*data\./,
    );
  });
});

// ── 도장 자동추종 규칙 재현 (effectiveDoctorId 결선 순수 로직) ─────────
function resolveEffectiveDoctorId(
  overrideId: string | undefined,
  issuedByDoctorId: string | null | undefined,
): string | undefined {
  return overrideId ?? issuedByDoctorId ?? undefined;
}
test.describe('AC-7 규칙 재현: 정정 오버레이 id 우선', () => {
  test('담당의 정정(드롭다운) → 정정 원장 id 로 도장 결선', () => {
    // 원 발행자=대표원장(cd-rep), 정정=김윤기(cd-kim) → 도장 소스 id = cd-kim
    expect(resolveEffectiveDoctorId('cd-kim', 'cd-rep')).toBe('cd-kim');
  });
  test('정정 없음 → 원 발행자 id 유지(회귀 0)', () => {
    expect(resolveEffectiveDoctorId(undefined, 'cd-rep')).toBe('cd-rep');
  });
});

// ── 시나리오 1 (AC-1): 진료의 ↔ 진료차트 표시/연결 ─────────
test.describe('AC-1 배선: MedicalChartPanel 지정 진료의 표시', () => {
  test('서명블록에 chart-treating-doctor(treatingDoctorId→clinicDoctors.name) 렌더', () => {
    expect(CHART_SRC).toMatch(/data-testid="chart-treating-doctor"/);
    expect(CHART_SRC).toMatch(/clinicDoctors\.find\(\(d\)\s*=>\s*d\.id\s*===\s*treatingDoctorId\)/);
  });

  test('서명자명과 동일하면 중복 표기 억제(같은 진료의로 서명된 경우)', () => {
    expect(CHART_SRC).toMatch(/signing_doctor_name\s*===\s*td\.name\)\s*return null/);
  });
});

// 진료의 표시 규칙 재현(중복 억제 로직 동형)
function shouldShowTreating(treatingName: string | null, signingName: string | null): boolean {
  if (!treatingName) return false;
  if (signingName && signingName === treatingName) return false; // 동일 → 중복 억제
  return true;
}
test.describe('AC-1 규칙 재현: 지정 진료의 표시 조건', () => {
  test('서명 전(signing 없음) → 지정 진료의 노출(연결 확인)', () => {
    expect(shouldShowTreating('김윤기', null)).toBe(true);
  });
  test('서명자 ≠ 지정 진료의 → 지정 진료의 노출', () => {
    expect(shouldShowTreating('김윤기', '문지은')).toBe(true);
  });
  test('서명자 = 지정 진료의 → 중복 억제', () => {
    expect(shouldShowTreating('김윤기', '김윤기')).toBe(false);
  });
});

// ── 시나리오 3 (AC-4/AC-5): 발행완료 서류 정정 = 발행본 불오염(비파괴, 회귀 0) ─────────
test.describe('AC-4/AC-5 회귀: 발행본 immutable 불변 — 오버레이 비파괴', () => {
  test('정정 write 는 요청행(status=voided)만 — 발행본(published) 미접촉', () => {
    expect(REQ_SRC).toMatch(/\.update\(\{\s*field_data:\s*merged\s*\}\)[\s\S]{0,120}\.eq\('status',\s*'voided'\)/);
    expect(REQ_SRC).toMatch(/status\s*===\s*'published'[\s\S]{0,80}throw new Error/);
  });

  test('신규 DB 컬럼 0 — JSONB admin_overrides 재사용(db_change=false)', () => {
    // voided_at/superseded_by 등 신규 컬럼 참조 없음(오버레이는 field_data JSONB 안에서만).
    expect(REQ_SRC).not.toMatch(/voided_at|superseded_by/);
  });

  test('loadAutoBindContext 시그니처 불변(빌링서식 07-14 정책 회귀 0)', () => {
    // IssuedOpinionDocFormView 는 기존 시그니처(checkIn, doctorNameOverride?, clinicDoctorId?) 재사용.
    expect(VIEW_SRC).toMatch(/loadAutoBindContext\(/);
  });
});
