import { supabase } from './supabase';

/**
 * T-20260602-foot-VISITTYPE-RETURNING-AUTOSET
 * 체크인 완료(check_ins.status='done') 시점에 customers.visit_type을
 * 'new' → 'returning'으로 자동 승격하는 공통 헬퍼.
 *
 * - `.eq('visit_type', 'new')` 가드로 멱등 (이미 returning이면 미변경, 타 필드 비손상).
 * - best-effort: 승격 실패가 체크인 완료 동선 자체를 막지 않도록 throw하지 않고
 *   에러를 로깅만 한다(AC-5).
 * - 완료 진입점이 복수(Dashboard 드래그/컨텍스트, PaymentDialog, PaymentMiniWindow)
 *   이므로 단일 헬퍼로 추출해 호출한다.
 */
export async function promoteVisitTypeToReturning(
  customerId: string | null | undefined,
): Promise<void> {
  if (!customerId) return;
  try {
    const { error } = await supabase
      .from('customers')
      .update({ visit_type: 'returning' })
      .eq('id', customerId)
      .eq('visit_type', 'new'); // 멱등: 이미 returning이면 덮어쓰기 방지
    if (error) {
      console.warn('[visit_type] promote to returning failed:', error.message);
    }
  } catch (e) {
    console.warn('[visit_type] promote to returning threw:', e);
  }
}
