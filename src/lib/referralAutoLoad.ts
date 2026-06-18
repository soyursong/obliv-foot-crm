// referralAutoLoad — 진료의뢰서(referral_letter) 검사결과·투약내용 자동 로드 (순수 read-only)
// Ticket: T-20260617-foot-DOCFORM-POPUP-OVERHAUL (Phase 1 / G4 / AC-4)
//
// 목적: 진료의뢰서 발급 시 "검사 결과({{test_result}})"·"투약 내용({{medication}})" 전용 영역을
//   차트 기존 데이터에서 자동 호출(reporter 김주연 총괄 pq4 확정):
//     · 검사 결과 = 발행된 KOH 균검사 결과지(form_submissions, koh_result, status='published') 이력.
//     · 투약 내용 = 처방한 약 이력(check_ins.prescription_items, 처방세트/퀵Rx 흡수분 포함).
//   자동 로드 후 원장이 수기 수정 가능(DocumentPrintPanel editableFields → autoValues 편집).
//
// 가드:
//   · read-only — 신규 mutation/스키마 변경 0. 기존 published 행 불변(의료법§22) 무영향.
//   · 결측/조회 실패 시 빈 문자열 반환(graceful) → 필드 공란 + 수기 입력 가능(회귀 0).
//   · KOH 실제 검사결과 라인(Hyphae/Yeast)은 결과지 양식 고정값이라 본 요약엔 메타(검체/채취일/
//     의뢰번호)만 담는다(KohPublishedResults 표기와 동일 소스).

import { supabase } from '@/lib/supabase';
import { formatRxItemToken } from '@/lib/rxTooltip';
import { seoulISODate } from '@/lib/format';

export interface ReferralAutoFields {
  /** 검사 결과 — 발행 KOH 결과지 요약(최신 우선, 최대 3건). 없으면 ''. */
  test_result: string;
  /** 투약 내용 — 최근 처방약 이력(약물명 1/3/2 토큰, 줄바꿈 구분). 없으면 ''. */
  medication: string;
}

/** 발행된 KOH 결과지 이력 → 요약 텍스트. clinic/customer 결측·조회실패 시 ''. */
async function loadKohResultSummary(clinicId: string, customerId: string): Promise<string> {
  try {
    const { data: tpl } = await supabase
      .from('form_templates')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('form_key', 'koh_result')
      .limit(1)
      .maybeSingle();
    if (!tpl?.id) return '';
    const { data, error } = await supabase
      .from('form_submissions')
      .select('field_data, created_at')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .eq('template_id', tpl.id)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(3);
    if (error || !data || data.length === 0) return '';
    return (data as Array<{ field_data: Record<string, unknown> | null; created_at: string }>)
      .map((r) => {
        const fd = r.field_data ?? {};
        const collected = String(fd['collected_date'] ?? seoulISODate(r.created_at));
        const specimen = String(fd['specimen_type'] ?? '').trim();
        const reqNo = String(fd['request_no'] ?? '').trim();
        const parts = [`KOH 균검사 (${collected})`];
        if (specimen) parts.push(`검체: ${specimen}`);
        if (reqNo) parts.push(`의뢰번호: ${reqNo}`);
        return parts.join(' · ');
      })
      .join('\n');
  } catch {
    return '';
  }
}

/** 최근 처방약 이력(check_ins.prescription_items) → '약물명 1/3/2' 토큰 줄바꿈 텍스트. 없으면 ''. */
async function loadMedicationSummary(clinicId: string, customerId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('check_ins')
      .select('prescription_items, checked_in_at')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .not('prescription_items', 'is', null)
      .order('checked_in_at', { ascending: false })
      .limit(5);
    if (error || !data || data.length === 0) return '';
    // 최신 check_in부터 prescription_items 가 실제 비어있지 않은 첫 건을 채택.
    for (const row of data as Array<{ prescription_items: unknown }>) {
      const items = row.prescription_items;
      if (Array.isArray(items) && items.length > 0) {
        const lines = items
          .map((it) => formatRxItemToken(it).trim())
          .filter((s) => s.length > 0);
        if (lines.length > 0) return lines.join('\n');
      }
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 진료의뢰서 검사결과·투약내용 자동 로드. clinic/customer 결측 시 빈 필드 반환.
 * 두 소스 독립 조회(부분 실패 흡수) — 한 쪽 없어도 다른 쪽은 채워짐.
 */
export async function loadReferralAutoFields(
  clinicId: string | null | undefined,
  customerId: string | null | undefined,
): Promise<ReferralAutoFields> {
  if (!clinicId || !customerId) return { test_result: '', medication: '' };
  const [test_result, medication] = await Promise.all([
    loadKohResultSummary(clinicId, customerId),
    loadMedicationSummary(clinicId, customerId),
  ]);
  return { test_result, medication };
}
