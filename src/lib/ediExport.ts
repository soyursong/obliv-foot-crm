/**
 * ediExport.ts — 심평원 표준 청구명세서(요양급여비용 명세서) 표준 범용 logical export
 *
 * T-20260629-foot-EDI-EXPORT-IMPL
 * SSOT: edi_export_data_contract_20260629.md (DA-20260629-EDI-EXPORT-CONTRACT)
 *
 * 책임 경계 (A안):
 *   명세 생성 → 심평원 표준 **범용 logical** 포맷 변환 → 보관 까지.
 *   ❌ 실제 심평원 전자전송(D2 보류) — 인증 청구SW 가 import 후 수행. transmitted 미사용.
 *   ❌ 특정 청구SW 물리 레이아웃(고정폭/세그먼트 byte) 종속(D1) — 본 모듈은 범용 logical 까지만.
 *
 * 본 파일 = 순수 함수(외부 의존 없음). 가드 로직 SSOT. 단위테스트·UI 미리보기 공용.
 * DB 적재값은 claim_items/service_charges(§2-2 산식 SSOT)를 그대로 싣는다(재산출 안 함).
 */

import type { InsuranceGrade } from './insurance';

/** 표준포맷 logical 모델 버전. SW 선정 후 물리 직렬화 확정 시 갱신(D1). */
export const EDI_EXPORT_FORMAT_VERSION = 'hira-edi-logical-v1';

// ──────────────────────────────────────────────────────────
// 본인부담구분코드 매핑 (★ 율(%) 아니라 구분코드 — DA 계약 §2-4)
// ──────────────────────────────────────────────────────────
//
// 심평원 명세서는 본인부담을 ① 금액(copayment_amount) + ② 본인부담구분코드 로 표현.
// 구분코드 '값'은 NHIS 고시(규제 사실) → TK-ACC-2 접지 전까지 DA/dev 가 발명 금지(날조 금지).
//   - general(일반 건강보험): 별도 본인부담구분코드 없음(정상 일반부담) → code='' (접지된 사실).
//   - 그 외 등급(의료급여·차상위·6세미만·65세정액·미확인): 구분코드 TK-ACC-2 미접지 → export BLOCK.
//   - foreigner: 비급여(급여 명세에 포함될 수 없음) → 미접지 처리.

export interface CopayClassCode {
  /** 본인부담구분코드 값. '' = 일반(구분코드 없음, 접지됨). null = 미접지(BLOCK 대상). */
  code: string | null;
  /** NHIS 고시 접지 완료 여부. false = TK-ACC-2 미접지 → export 보류. */
  grounded: boolean;
}

/**
 * 등급 → 본인부담구분코드 매핑.
 * ★ 미접지 등급은 grounded=false 로 반환 → buildEdiExport 가 BLOCK.
 *   접지 확정(TK-ACC-2) 시 이 맵만 갱신하면 됨(코드 값 단일 출처).
 */
export function copayClassCode(grade: InsuranceGrade | string | null | undefined): CopayClassCode {
  switch (grade) {
    case 'general':
      // 일반 건강보험 = 별도 본인부담구분코드 없음(blank). 규제상 접지된 사실.
      return { code: '', grounded: true };
    // ↓ 구분코드 값이 NHIS 고시 규제 사실 — TK-ACC-2 접지 전 export 금지(날조 금지).
    case 'medical_aid_1':
    case 'medical_aid_2':
    case 'low_income_1':
    case 'low_income_2':
    case 'infant':
    case 'elderly_flat':
    case 'foreigner':
    case 'unverified':
    default:
      return { code: null, grounded: false };
  }
}

// ──────────────────────────────────────────────────────────
// Export 입력/출력 타입 (표준 명세서 3계층 logical)
// ──────────────────────────────────────────────────────────

/** ① 명세서 일반내역(헤더) 입력 */
export interface EdiClaimInput {
  claim_id: string;
  clinic_nhis_code: string | null | undefined;   // 요양기관기호(per-clinic 설정값, AC-5)
  clinic_name: string | null | undefined;
  visit_date: string;                              // 진료개시일(헤더)
  patient_name: string | null | undefined;         // 환자 식별(PHI)
  patient_chart_no: string | null | undefined;
  total_base: number;
  total_copayment: number;
  total_covered: number;
}

/** ③ 진료내역(줄번호) 입력 — claim_items(적재값) + service_charges(등급·율 스냅샷) 조인 */
export interface EdiItemInput {
  service_id: string;
  service_name: string | null | undefined;
  hira_code: string | null;                        // AA154(초진)/AA254(재진) 등 — 적재 스냅샷
  hira_category: string | null;
  base_amount: number;
  copayment_amount: number;
  insurance_covered_amount: number;                // = base − copay (§2-3)
  /** 차지 시점 스냅샷(service_charges, §2-2 SSOT) */
  grade_at_charge: InsuranceGrade | string | null;
  copayment_rate_at_charge: number | null;
  is_insurance_covered: boolean;
  hira_score_at_charge: number | null;
}

/** ② 상병내역 입력 */
export interface EdiDiagnosisInput {
  kcd_code: string;
  is_primary: boolean;
  sort_order: number;
}

export interface EdiExportInput {
  claim: EdiClaimInput;
  items: EdiItemInput[];
  diagnoses: EdiDiagnosisInput[];
}

// ── 출력(렌더된 표준 명세서 logical 모델) ──

export interface EdiExportItem {
  hira_code: string | null;
  hira_category: string | null;
  service_name: string | null;
  quantity: number;
  unit_amount: number;            // 단가(= base_amount, 수량 1 기준)
  base_amount: number;            // 금액(수가 총액)
  copayment_amount: number;       // 본인부담(줄)
  insurance_covered_amount: number; // 공단부담(줄)
  copay_class_code: string;       // 본인부담구분코드(등급 매핑)
  copay_grade: string;
}

export interface EdiExportPayload {
  format_version: string;
  /** ① 명세서 일반내역(헤더) */
  header: {
    claim_id: string;
    institution_code: string;     // 요양기관기호
    clinic_name: string;
    visit_date: string;
    patient_name: string;
    patient_chart_no: string;
    total_base: number;
    total_copayment: number;
    total_covered: number;
  };
  /** ② 상병내역(KCD) */
  diagnoses: Array<{ kcd_code: string; is_primary: boolean; sort_order: number }>;
  /** ③ 진료내역(줄번호) */
  items: EdiExportItem[];
}

export type EdiBlockCode =
  | 'MISSING_INSTITUTION_CODE'   // 요양기관기호 미설정(AC-5)
  | 'NO_ITEMS'                   // 청구 항목 없음
  | 'NO_PRIMARY_DIAGNOSIS'       // 주상병 누락
  | 'DATA_INCOMPLETE'            // 공단부담 미산출(환수 가드, AC-4)
  | 'RATE_MISSING'               // 적용률 미기록(AC-3)
  | 'COPAY_CLASS_UNGROUNDED';    // 본인부담구분코드 미접지(AC-3)

export interface EdiExportBlocked {
  ok: false;
  block_code: EdiBlockCode;
  block_reason: string;
  /** 어떤 줄/등급이 막았는지(현장 안내용, PII 아님) */
  detail?: string;
}

export interface EdiExportOk {
  ok: true;
  payload: EdiExportPayload;
}

export type EdiExportResult = EdiExportOk | EdiExportBlocked;

// ──────────────────────────────────────────────────────────
// 핵심: 표준 명세서 logical 빌드 + 가드 (순수 함수)
// ──────────────────────────────────────────────────────────

/**
 * 청구 1건 → 심평원 표준 청구명세서 logical 모델 빌드.
 * 가드(위반=export BLOCK, 날조/환수/전송 차단)를 순서대로 적용.
 */
export function buildEdiExport(input: EdiExportInput): EdiExportResult {
  const { claim, items, diagnoses } = input;

  // ── AC-5: 요양기관기호 미설정 → BLOCK (DA 가 발명 안 함) ──
  const institution = (claim.clinic_nhis_code ?? '').trim();
  if (!institution) {
    return {
      ok: false,
      block_code: 'MISSING_INSTITUTION_CODE',
      block_reason: '요양기관기호가 설정되지 않아 export 할 수 없습니다. 기관 설정에서 요양기관기호를 입력하세요.',
    };
  }

  // ── 항목 0건 → BLOCK ──
  if (!items || items.length === 0) {
    return {
      ok: false,
      block_code: 'NO_ITEMS',
      block_reason: '청구 항목이 없는 명세는 export 할 수 없습니다.',
    };
  }

  // ── 주상병 1건 필수 ──
  const hasPrimary = diagnoses.some((d) => d.is_primary);
  if (diagnoses.length > 0 && !hasPrimary) {
    return {
      ok: false,
      block_code: 'NO_PRIMARY_DIAGNOSIS',
      block_reason: '주상병이 지정되지 않았습니다. 상병내역에 주상병 1건을 지정하세요.',
    };
  }

  const exportItems: EdiExportItem[] = [];

  for (const it of items) {
    const isCovered = it.is_insurance_covered;

    // ── AC-4 환수 가드: data_incomplete (공단부담 미산출) → BLOCK ──
    //   급여 + hira_score NULL + 등급≠general = calc_copayment v1.2 가 data_incomplete=true 반환한 차지.
    //   phantom 공단부담액 export = 공단 과대청구·환수(clawback) 방향 → 명세 전체 제외.
    const dataIncomplete =
      isCovered && it.hira_score_at_charge == null && it.grade_at_charge !== 'general';
    if (dataIncomplete) {
      return {
        ok: false,
        block_code: 'DATA_INCOMPLETE',
        block_reason: '공단부담이 미산출된(데이터 불완전) 항목이 포함되어 있어 export 할 수 없습니다. 해당 항목의 수가 점수를 확정한 뒤 다시 산출하세요.',
        detail: it.service_name ?? it.service_id,
      };
    }

    // ── AC-3: 적용률 미기록(급여건) → export 제외(계약 위반 추적) ──
    if (isCovered && it.copayment_rate_at_charge == null) {
      return {
        ok: false,
        block_code: 'RATE_MISSING',
        block_reason: '본인부담 적용률이 기록되지 않은 급여 항목이 포함되어 있어 export 할 수 없습니다.',
        detail: it.service_name ?? it.service_id,
      };
    }

    // ── AC-3: 본인부담구분코드 — 율 아니라 구분코드. 미접지 등급 → BLOCK(날조 금지) ──
    const cls = copayClassCode(it.grade_at_charge);
    if (!cls.grounded) {
      return {
        ok: false,
        block_code: 'COPAY_CLASS_UNGROUNDED',
        block_reason: `본인부담구분코드가 아직 확정되지 않은 자격등급(${it.grade_at_charge ?? '미확인'})이 포함되어 export 할 수 없습니다. 의료급여·차상위 등 구분코드는 추후 NHIS 고시 접지 후 export 가능합니다.`,
        detail: it.service_name ?? it.service_id,
      };
    }

    exportItems.push({
      hira_code: it.hira_code,
      hira_category: it.hira_category,
      service_name: it.service_name ?? null,
      quantity: 1,
      unit_amount: it.base_amount,
      base_amount: it.base_amount,
      copayment_amount: it.copayment_amount,
      insurance_covered_amount: it.insurance_covered_amount,
      copay_class_code: cls.code ?? '',
      copay_grade: String(it.grade_at_charge ?? ''),
    });
  }

  const sortedDx = [...diagnoses].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });

  const payload: EdiExportPayload = {
    format_version: EDI_EXPORT_FORMAT_VERSION,
    header: {
      claim_id: claim.claim_id,
      institution_code: institution,
      clinic_name: claim.clinic_name ?? '',
      visit_date: claim.visit_date,
      patient_name: claim.patient_name ?? '',
      patient_chart_no: claim.patient_chart_no ?? '',
      total_base: claim.total_base,
      total_copayment: claim.total_copayment,
      total_covered: claim.total_covered,
    },
    diagnoses: sortedDx.map((d) => ({
      kcd_code: d.kcd_code,
      is_primary: d.is_primary,
      sort_order: d.sort_order,
    })),
    items: exportItems,
  };

  return { ok: true, payload };
}

/**
 * export 산출물 참조키 — 결정적(재현 가능) + 무결성. PHI 평문 미포함(git/저장소 유출 금지, §5).
 * 실제 파일은 4테이블에서 결정적으로 재생성 가능하므로 ref 는 식별·무결성 용도.
 */
export function exportPayloadRef(claimId: string, fingerprint: string): string {
  return `edi-export/${claimId}/${EDI_EXPORT_FORMAT_VERSION}#${fingerprint}`;
}

/** 산출물 금액 합계 기반 경량 지문(비-PHI). 동일 청구 재export 일관성 확인용. */
export function payloadFingerprint(payload: EdiExportPayload): string {
  const h = payload.header;
  const sum =
    h.total_base * 31 +
    h.total_copayment * 17 +
    h.total_covered * 13 +
    payload.items.length * 7 +
    payload.diagnoses.length;
  return `${sum.toString(36)}-${payload.items.length}i${payload.diagnoses.length}d`;
}
