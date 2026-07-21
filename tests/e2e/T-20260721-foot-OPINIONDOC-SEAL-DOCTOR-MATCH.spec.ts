/**
 * E2E Spec — T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH
 *
 * [P0] 소견서 담당의사-도장(직인) 매칭 오류.
 *      문지은 원장 담당(발행) 소견서에 김윤기 원장 도장이 잘못 찍힘.
 *      올바른 동작 = 각 발행 진료의 본인 직인(문지은 발행 → 문지은 직인).
 *
 * Root Cause (런타임 규명 — 프로드 발행본 데이터 대조):
 *   소견서 출력의 두 소스가 갈렸다.
 *     · 이름란(doctor_name) = 발행본 스냅샷 issued_by_name(= 발행 진료의, 문지은) — printOpinionDoc override.
 *     · 도장(doctor_seal_html) = loadAutoBindContext 가 '내원행(check_in)의 treating_doctor_id/duty_roster'로
 *       독립 해석한 진료의의 clinic_doctors.seal_image_url.
 *   F-4808 김문재: 발행본 8460fd93 = issued_by_doctor_id cd2639d0(문지은), 그 원 방문 check_in b369c72d 의
 *   treating_doctor_id = 57953f10(김윤기). → 이름=문지은 / 도장=김윤기(방문 치료의). 발행자≠치료의라 도장이 갈림.
 *   (동일 방문에 김윤기 발행본 abab67f1 도 존재 — 치료의=김윤기라 우연히 일치해 오류가 안 보였음.)
 *
 * Fix (발행자-앵커 도장 결선, db_change=false, autoBindContext.ts 무변경):
 *   소견서/진단서 발행본 출력 경로가 loadAutoBindContext 에 '발행자'를 넘겨 도장을 발행자 본인 직인으로 결선.
 *     · loadAutoBindContext(checkIn, doctorNameOverride?, clinicDoctorId?) 기존 시그니처 재사용(신규 인자 0).
 *     · clinicDoctorId(1순위) = 발행자 clinic_doctors.id(issued_by_doctor_id) → 정확 결선(동명이인 무관).
 *     · doctorNameOverride = 발행자명(issued_by_name) → 레거시(스냅샷 id 부재) 이름폴백.
 *   호출부:
 *     · OpinionDocTab.handlePrint(원장탭)  → loadAutoBindContext(checkIn, row.issued_by_name, row.issued_by_doctor_id)
 *     · medDocPrintGate.printAuthoredMedDoc(데스크·수납) → loadAutoBindContext(ctx.checkIn, doc.issuedByName, doc.issuedByDoctorId)
 *   ⚠ 스코프 격리: autoBindContext.shouldForceInstitutionSeal(문지은→법인인감, 07-14 DOCTOR-UNLINKED
 *     commit 0ed89b54) + 미지정폴백(sealFallbackToInstitution) 로직 무변경. 빌링서식(계산서·영수증·
 *     세부산정내역서)의 자체 loadAutoBindContext 호출부(발행자 인자 미전달) 무접점 → 07-14 정책 회귀 0.
 *
 * AC (canon 티켓):
 *   시나리오1  문지은 발행 소견서 → 도장란에 문지은 본인 직인(김윤기 아님)
 *   시나리오2  타 진료의(김윤기/한동훈/김상은) 발행 → 각 본인 직인, 오매핑 0
 *   회귀       빌링서식 문지은→법인인감(07-14) 불변 / 레거시(id 부재) 이름폴백 / autoBindContext.ts 무변경
 *
 * 실행: npx playwright test --project=unit T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH.spec.ts
 * NOTE: 도장 결선 = loadAutoBindContext 의 clinicDoctor 해석 규칙(DB I/O). 배선 계약=정적 소스 가드 +
 *       해석 규칙=순수 로직 재현(DIAGCODE-BLANK/DESK-BLANK spec 관행 계승). 라이브 렌더 실측은
 *       supervisor QA + 김주연 총괄 confirm_gate(법정성 서류 직인 정확성).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/autoBindContext.ts'), 'utf-8');
const GATE_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/medDocPrintGate.ts'), 'utf-8');
const TAB_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/doctor/OpinionDocTab.tsx'), 'utf-8');

// ── AC-1 배선: OpinionDocTab(원장탭) handlePrint 발행자-앵커 도장 결선 ─────────
test.describe('AC-1 배선: OpinionDocTab handlePrint → loadAutoBindContext(발행자)', () => {
  test('PublishedOpinionRow.issued_by_doctor_id 필드 + field_data 추출', () => {
    expect(TAB_SRC, 'PublishedOpinionRow.issued_by_doctor_id 인터페이스 누락').toMatch(
      /issued_by_doctor_id:\s*string\s*\|\s*null;/,
    );
    expect(TAB_SRC, 'field_data.issued_by_doctor_id 추출 누락').toMatch(
      /issued_by_doctor_id:\s*\(fd\['issued_by_doctor_id'\]/,
    );
  });

  test('loadAutoBindContext 에 발행자명 + 발행자 clinic_doctors.id 전달', () => {
    // loadAutoBindContext(checkIn, row.issued_by_name || undefined, row.issued_by_doctor_id ?? undefined)
    expect(TAB_SRC).toMatch(
      /loadAutoBindContext\(\s*checkIn,\s*row\.issued_by_name\s*\|\|\s*undefined,\s*row\.issued_by_doctor_id\s*\?\?\s*undefined,?\s*\)/,
    );
  });
});

// ── AC-2 배선: medDocPrintGate(데스크·수납) printAuthoredMedDoc 발행자-앵커 ──────
test.describe('AC-2 배선: printAuthoredMedDoc → loadAutoBindContext(발행자)', () => {
  test('AuthoredMedDoc.issuedByDoctorId 필드 + field_data 추출', () => {
    expect(GATE_SRC, 'AuthoredMedDoc.issuedByDoctorId 인터페이스 누락').toMatch(
      /issuedByDoctorId:\s*string\s*\|\s*null;/,
    );
    expect(GATE_SRC, 'field_data.issued_by_doctor_id 추출 누락').toMatch(
      /issuedByDoctorId:\s*\(fd\['issued_by_doctor_id'\]/,
    );
  });

  test('loadAutoBindContext 에 발행자명 + 발행자 clinic_doctors.id 전달', () => {
    expect(GATE_SRC).toMatch(
      /loadAutoBindContext\(\s*ctx\.checkIn,\s*doc\.issuedByName\s*\|\|\s*undefined,\s*doc\.issuedByDoctorId\s*\?\?\s*undefined,?\s*\)/,
    );
  });
});

// ── 스코프 격리: autoBindContext.ts 도장 정책 불변(빌링서식 07-14 회귀 0) ────────
test.describe('스코프 격리: 07-14 빌링서식 법인인감 정책 불변', () => {
  test('loadAutoBindContext 시그니처(checkIn, doctorNameOverride?, clinicDoctorId?) 재사용 — 신규 인자 0', () => {
    expect(ABC_SRC).toMatch(/doctorNameOverride\?:\s*string,/);
    expect(ABC_SRC).toMatch(/clinicDoctorId\?:\s*string,?/);
  });

  test('shouldForceInstitutionSeal = sealFallbackToInstitution 반환(미지정폴백 한정, 불변)', () => {
    expect(ABC_SRC).toMatch(/function\s+shouldForceInstitutionSeal/);
    expect(ABC_SRC, '법인인감 강제 경로가 미지정폴백 외로 확장됨(07-14 정책 훼손)').toMatch(
      /shouldForceInstitutionSeal[\s\S]{0,120}return\s+sealFallbackToInstitution;/,
    );
  });

  test('clinicDoctorId 1순위 결선(id 직접 지정) 규칙 유지', () => {
    expect(ABC_SRC).toMatch(/if\s*\(clinicDoctorId\)\s*\{[\s\S]{0,120}find\(\(d\)\s*=>\s*d\.id\s*===\s*clinicDoctorId\)/);
  });
});

// ── 도장 결선 규칙 재현 (loadAutoBindContext clinicDoctor 해석부 순수 로직) ───────
// autoBindContext.ts L650(doctorName)·L711-730(clinicDoctor 결선)의 알고리즘과 동형.
interface Doc { id: string; name: string; seal: string | null; is_default: boolean }
function resolveSeal(
  clinicDoctors: Doc[],
  opts: { clinicDoctorId?: string; doctorNameOverride?: string; treatingDoctorId?: string | null },
): { doctorName: string | null; seal: string | null; sealFallbackToInstitution: boolean } {
  const { clinicDoctorId, doctorNameOverride, treatingDoctorId } = opts;
  const treatingDoctor = treatingDoctorId
    ? clinicDoctors.find((d) => d.id === treatingDoctorId) ?? null
    : null;

  // doctorName 결정 (L650~): override 있으면 그 이름, 없으면 치료의(단순화: 방문 치료의)
  let doctorName: string | null = null;
  let sealFallbackToInstitution = false;
  if (doctorNameOverride !== undefined) doctorName = doctorNameOverride || null;
  else if (treatingDoctor?.name) doctorName = treatingDoctor.name;
  else if (clinicDoctors.length > 0) {
    // L693~703: duty/치료의 미지정 자동발행 폴백 — 대표원장(is_default)로 이름 채우고 법인인감 강제.
    const representative = clinicDoctors.find((d) => d.is_default) ?? clinicDoctors[0] ?? null;
    if (representative?.name) {
      doctorName = representative.name;
      sealFallbackToInstitution = true;
    }
  }

  // clinicDoctor 결선 (L711~)
  let clinicDoctor: Doc | null = null;
  if (clinicDoctorId) clinicDoctor = clinicDoctors.find((d) => d.id === clinicDoctorId) ?? null;
  if (!clinicDoctor && clinicDoctorId === undefined && doctorNameOverride === undefined && treatingDoctor)
    clinicDoctor = treatingDoctor;
  if (!clinicDoctor && doctorName) clinicDoctor = clinicDoctors.find((d) => d.name === doctorName) ?? null;
  if (!clinicDoctor) {
    clinicDoctor = clinicDoctors.find((d) => d.is_default) ?? clinicDoctors[0] ?? null;
    sealFallbackToInstitution = true;
  }
  // forceInstitutionSeal = sealFallbackToInstitution (미지정폴백 한정): 도장 슬롯을 법인인감으로 비움
  const seal = sealFallbackToInstitution ? null : clinicDoctor?.seal ?? null;
  return { doctorName, seal: clinicDoctor ? seal : null, sealFallbackToInstitution };
}

// 프로드 실측 clinic_doctors(jongno-foot) — seal 은 식별용 축약.
const DOCS: Doc[] = [
  { id: 'cd2639d0-a3d6-47f9-901e-5b841a4ce6d0', name: '문지은', seal: 'seal_문지은', is_default: true },
  { id: 'ab2819be-d56c-41b9-bc97-da01123ab2a6', name: '한동훈', seal: 'seal_한동훈', is_default: false },
  { id: '57953f10-1427-438e-9406-ee0b02efef44', name: '김윤기', seal: 'seal_김윤기', is_default: false },
  { id: 'ec70414e-27cc-4929-a73d-e1d5f3164716', name: '김상은', seal: 'seal_김상은', is_default: false },
];
const MOON = DOCS[0];
const KIM_YG = DOCS[2];

test.describe('도장 결선: 발행자-앵커(F-4808 실측 재현)', () => {
  test('버그 재현: 발행자 미전달 → 방문 치료의(김윤기) 도장이 찍힘', () => {
    // 수정 전 handlePrint/printAuthoredMedDoc = loadAutoBindContext(checkIn) (발행자 인자 없음)
    const r = resolveSeal(DOCS, { treatingDoctorId: KIM_YG.id });
    expect(r.doctorName).toBe('김윤기');
    expect(r.seal, '버그: 발행자(문지은) 아닌 치료의 도장').toBe('seal_김윤기');
  });

  test('시나리오1(FIX): 문지은 발행 소견서 → clinicDoctorId=문지은 → 문지은 본인 직인', () => {
    // 방문 치료의는 여전히 김윤기지만, 발행자 id 를 태우면 도장은 문지은.
    const r = resolveSeal(DOCS, {
      clinicDoctorId: MOON.id,
      doctorNameOverride: '문지은',
      treatingDoctorId: KIM_YG.id,
    });
    expect(r.doctorName).toBe('문지은');
    expect(r.seal, '문지은 발행인데 김윤기 도장(오매핑)').toBe('seal_문지은');
    expect(r.seal).not.toBe('seal_김윤기');
    expect(r.sealFallbackToInstitution, '지정 진료의인데 미지정폴백 오진입').toBe(false);
  });

  test('시나리오1(레거시 폴백): 스냅샷 id 부재 → 발행자명 이름폴백으로 문지은 도장', () => {
    const r = resolveSeal(DOCS, {
      clinicDoctorId: undefined,
      doctorNameOverride: '문지은',
      treatingDoctorId: KIM_YG.id,
    });
    expect(r.doctorName).toBe('문지은');
    expect(r.seal, '레거시 이름폴백 실패').toBe('seal_문지은');
    expect(r.sealFallbackToInstitution).toBe(false);
  });

  test('시나리오2(오매핑 0): 각 진료의 발행 → 각 본인 직인', () => {
    for (const doc of DOCS) {
      // 방문 치료의를 일부러 다른 의사로 두어도 도장은 발행자 본인.
      const r = resolveSeal(DOCS, {
        clinicDoctorId: doc.id,
        doctorNameOverride: doc.name,
        treatingDoctorId: KIM_YG.id,
      });
      expect(r.doctorName, `${doc.name} 이름 결선 실패`).toBe(doc.name);
      expect(r.seal, `${doc.name} 발행인데 본인 직인 아님`).toBe(doc.seal);
    }
  });
});

test.describe('회귀 0: 빌링서식 미지정폴백(07-14 법인인감) 경로 불변', () => {
  test('발행자·치료의 모두 미지정 → 대표원장(문지은) 폴백 + 법인인감 강제(seal 비움)', () => {
    // 빌링서식 자체 호출부(loadAutoBindContext(checkIn), 발행자 인자 미전달, 치료의도 없음)
    const r = resolveSeal(DOCS, {});
    expect(r.doctorName, '미지정 폴백은 대표원장명').toBe('문지은');
    expect(r.sealFallbackToInstitution, '미지정폴백 미진입(07-14 정책 훼손)').toBe(true);
    expect(r.seal, '미지정폴백인데 개인직인이 샘(07-14 회귀)').toBeNull();
  });
});
