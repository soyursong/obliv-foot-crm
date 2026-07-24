// opinionAutofillRef — 소견서·진단서 작성 폼(OpinionEditorDialog) '환자 자동연동' 3필드 로더 (순수 read-only)
// Ticket: T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK
//
// RC (런타임 재현으로 확정 — scripts/T-20260724-...-BLANK_probe.mjs):
//   기존 배선(T-20260724-foot-TREATTABLE-DOCS-PARITY 기능②)은 3필드를 아래 소스에서 읽어 전부 공란이었다.
//     · 생년월일 ← visitor.birth_date(=customers.birth_date). ★현장은 주민번호만 입력 → birth_date 컬럼이
//         구조적으로 비어있음(prod/dev 공통, T-20260601-foot-DOC-PRINT-8FIX 에서 이미 확인된 사실).
//         출력 서류(loadAutoBindContext)는 주민번호 복호화본에서 생년월일을 산출(deriveBirthYYMMDDFromRrn)해
//         정상 표기하는데, 이 참고 박스만 그 폴백을 안 써서 항상 '없음' 이었다.
//     · 당일 시술 ← useQueueClinicalSnaps: medical_charts.treatment_record. ★진료대시보드 '오늘시술'이 읽는
//         실 SSOT 는 check_ins 계열/방문 시술항목(check_in_services)이고 medical_charts.treatment_record 는
//         거의 미기록(런타임 채움율 23행) → 당일 방문에 차트가 아직 없으면 NO-CHART=공란.
//     · 처방내역 ← useQueueClinicalSnaps: medical_charts.prescription_items. 실 처방 데이터는 방문에 따라
//         check_ins.prescription_items 또는 medical_charts.prescription_items 로 갈려 저장돼(런타임 확인),
//         한 소스만 보면 데이터가 있어도 공란.
//
// 수정 방침(읽기 전용 결선 복구, DDL/write/스키마 변경 0):
//   3필드를 실제 데이터가 존재하는 SSOT 에 다시 결선한다. 전부 customer_id / check_in_id 스코프 → 타 환자 유입 배제.
//     · 생년월일 = customers.birth_date, 없으면 주민번호 복호화본에서 산출(loadAutoBindContext 와 동일 헬퍼 재사용).
//     · 당일 시술 = 이 방문(check_in_id)의 check_in_services.service_name 목록. 없으면 그 고객 최신 medical_charts.treatment_record 폴백.
//     · 처방내역 = 이 방문(check_in_id)의 check_ins.prescription_items, 없으면 그 고객 최신 medical_charts.prescription_items,
//         그래도 없으면 그 고객 최신 처방 있는 check_in(referralAutoLoad 투약내용 패턴) 폴백.
//   결측/조회 실패 시 빈 문자열(graceful) → 필드 '없음' 표기 + 폼 정상 렌더(AC-4 엣지). 편집 필드 아님(read-only 참고).

import { supabase } from '@/lib/supabase';
import { formatBirthDate, deriveBirthYYMMDDFromRrn } from '@/lib/autoBindContext';
import { formatRxItemToken } from '@/lib/rxTooltip';

export interface OpinionAutofillRef {
  /** 생년월일 — "YYYY년 MM월 DD일" 또는 ''(데이터 없음). */
  birthDisplay: string;
  /** 당일 시술 — 이 방문 시술항목(', ' 구분) 또는 최신 진료차트 치료내용. 없으면 ''. */
  treatment: string;
  /** 처방내역 — 이 방문 처방약 요약(', ' 구분) 또는 최신 처방 폴백. 없으면 ''. */
  prescription: string;
}

const EMPTY: OpinionAutofillRef = { birthDisplay: '', treatment: '', prescription: '' };

/** prescription_items(JSONB 배열) → 약물명 토큰 요약(', ' 구분). 빈/결측 시 null. (opinionRequest.summarizeRxItems 동일 규칙) */
function summarizeRx(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const tokens = items
    .map((it) => formatRxItemToken(it).trim())
    .filter((s) => s.length > 0 && s !== '(이름 미입력)');
  return tokens.length > 0 ? tokens.join(', ') : null;
}

/** 생년월일 결선: customers.birth_date 우선, 없으면 주민번호 복호화본 산출(출력서류와 동일 폴백). */
async function loadBirthDisplay(customerId: string): Promise<string> {
  try {
    const [{ data: cust }, { data: rrn }] = await Promise.all([
      supabase.from('customers').select('birth_date').eq('id', customerId).maybeSingle(),
      supabase.rpc('rrn_decrypt', { customer_uuid: customerId }),
    ]);
    const bd = (cust?.birth_date as string | null) ?? null;
    if (bd) return formatBirthDate(bd);
    const derived = deriveBirthYYMMDDFromRrn(rrn as string | null);
    return derived ? formatBirthDate(derived) : '';
  } catch {
    return '';
  }
}

/** 당일 시술 결선: 이 방문 check_in_services.service_name, 없으면 그 고객 최신 medical_charts.treatment_record. */
async function loadTreatment(clinicId: string, customerId: string, checkInId: string | null): Promise<string> {
  try {
    if (checkInId) {
      const { data: svc } = await supabase
        .from('check_in_services')
        .select('service_name')
        .eq('check_in_id', checkInId)
        .order('created_at', { ascending: true });
      const names = (svc ?? [])
        .map((r) => String((r as { service_name?: string | null }).service_name ?? '').trim())
        .filter((s) => s.length > 0);
      if (names.length > 0) return [...new Set(names)].join(', ');
    }
    const { data: mc } = await supabase
      .from('medical_charts')
      .select('treatment_record, visit_date, created_at')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .not('treatment_record', 'is', null)
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const tr = String((mc as { treatment_record?: string | null } | null)?.treatment_record ?? '').trim();
    return tr;
  } catch {
    return '';
  }
}

/** 처방내역 결선: 이 방문 check_ins.prescription_items → 최신 medical_charts.prescription_items → 최신 처방 있는 check_in. */
async function loadPrescription(clinicId: string, customerId: string, checkInId: string | null): Promise<string> {
  try {
    if (checkInId) {
      const { data: ci } = await supabase
        .from('check_ins')
        .select('prescription_items')
        .eq('id', checkInId)
        .maybeSingle();
      const s = summarizeRx((ci as { prescription_items?: unknown } | null)?.prescription_items);
      if (s) return s;
    }
    // 최신 medical_charts 처방(실 처방 데이터가 차트에 저장된 방문 대응).
    const { data: mc } = await supabase
      .from('medical_charts')
      .select('prescription_items, visit_date, created_at')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .not('prescription_items', 'is', null)
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(3);
    for (const row of (mc ?? []) as Array<{ prescription_items: unknown }>) {
      const s = summarizeRx(row.prescription_items);
      if (s) return s;
    }
    // 최신 처방 있는 check_in 폴백(referralAutoLoad 투약내용 패턴).
    const { data: cis } = await supabase
      .from('check_ins')
      .select('prescription_items, checked_in_at')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .not('prescription_items', 'is', null)
      .order('checked_in_at', { ascending: false })
      .limit(5);
    for (const row of (cis ?? []) as Array<{ prescription_items: unknown }>) {
      const s = summarizeRx(row.prescription_items);
      if (s) return s;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 소견서 작성 폼 '환자 자동연동' 3필드 로드. clinic/customer 결측 시 빈 값(폼 정상 렌더).
 * 세 소스 독립 조회(부분 실패 흡수) — 한 축 없어도 다른 축은 채워짐.
 */
export async function loadOpinionAutofillRef(
  clinicId: string | null | undefined,
  customerId: string | null | undefined,
  checkInId: string | null | undefined,
): Promise<OpinionAutofillRef> {
  if (!clinicId || !customerId) return EMPTY;
  const [birthDisplay, treatment, prescription] = await Promise.all([
    loadBirthDisplay(customerId),
    loadTreatment(clinicId, customerId, checkInId ?? null),
    loadPrescription(clinicId, customerId, checkInId ?? null),
  ]);
  return { birthDisplay, treatment, prescription };
}
