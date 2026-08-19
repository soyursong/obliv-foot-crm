// T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
//   canonical consumption primitive(consume_one_session) 클라 라우팅 헬퍼.
//   6개 client 直insert(saveUseSession/saveC22Deduct/handleDupAddSession/handleHealerDeduct/
//   SessionUseInSheetDialog/Packages)가 package_sessions 를 직접 insert 하던 것을 단일 서버 RPC 로
//   라우팅(AC-SW single-writer). RPC 내부에서 (i)package_sessions INSERT (ii)fn_mark_cis_for_consumed_session
//   로 check_in_services 마킹(flag∧FK co-set)을 원자 수행 → 재진 no-payment forward-source 소스닫힘.
import { supabase } from './supabase';
import { prepaidSessionType } from '@/components/PaymentMiniWindow';

export interface ServiceSessionPair {
  service_id: string;
  session_type: string;
}

/**
 * 회차 소비 시 CIS(check_in_services) 마킹 대상 service_id 를 deterministic(C1) 로 해소한다.
 * 서버 fuzzy 금지 원칙(§32) 준수 — 클라가 확정한 service_id 집합만 RPC 에 전달.
 *
 * 안전성(monotonic): 요청 session_type 으로 **분류되는** 미마킹 CIS 행의 service_id 만 반환한다.
 *   → 서버 헬퍼는 이 집합 ∩ session_type 으로 FIFO-first 1행을 마킹 → 오분류 불가(prepaidSessionType SSOT).
 *   대응 CIS 부재/체크인 없음 → 빈 배열 → RPC 는 p_service_sessions=null 로 skip(회차만 소진 = 기존 동작).
 *
 * @param checkInId    소비 귀속 체크인(없으면 마킹 대상 없음)
 * @param sessionType  소비 session_type(heated_laser/unheated_laser/iv/podologue …)
 * @param qty          소비 회차 수(대응 CIS 후보 상한)
 */
export async function resolvePackageServiceSessions(
  checkInId: string | null | undefined,
  sessionType: string,
  qty = 1,
): Promise<ServiceSessionPair[]> {
  if (!checkInId) return [];
  // 미마킹 CIS 행 + 대응 service 분류정보(name/category/service_code) 조회.
  const { data, error } = await supabase
    .from('check_in_services')
    .select('service_id, created_at, service:services(name, category, service_code)')
    .eq('check_in_id', checkInId)
    .is('package_session_id', null)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  const pairs: ServiceSessionPair[] = [];
  for (const row of data as unknown as {
    service_id: string | null;
    service: { name?: string | null; category?: string | null; service_code?: string | null } | null;
  }[]) {
    if (!row.service_id || !row.service) continue;
    const st = prepaidSessionType(row.service);
    if (st === sessionType) {
      pairs.push({ service_id: row.service_id, session_type: sessionType });
      if (pairs.length >= qty) break;
    }
  }
  return pairs;
}

export interface ConsumeOneSessionParams {
  packageId: string;
  sessionType: string;
  checkInId?: string | null;
  sessionDate?: string | null;
  performedBy?: string | null;
  treatmentStartedAt?: string | null;
  treatmentEndedAt?: string | null;
  surcharge?: number | null;
  surchargeMemo?: string | null;
  serviceSessions?: ServiceSessionPair[] | null;
}

export interface ConsumeOneSessionResult {
  ok: boolean;
  code?: string;
  error?: string;
  session_id?: string;
  session_number?: number;
  session_type?: string;
  marked?: boolean;
}

/**
 * canonical consumption primitive 호출. package_sessions 'used' 1건 INSERT + CIS co-set(단일 writer).
 * serviceSessions 미지정 시 resolvePackageServiceSessions 로 자동 해소(대응 CIS 있으면 마킹, 없으면 skip).
 * 반환: { ok, error?, ... } — 호출측이 error 를 그대로 노출하면 기존 insert-error 토스트와 동형.
 */
export async function consumeOneSession(
  params: ConsumeOneSessionParams,
): Promise<{ result: ConsumeOneSessionResult | null; error: string | null }> {
  let serviceSessions = params.serviceSessions ?? null;
  if (serviceSessions == null) {
    const resolved = await resolvePackageServiceSessions(params.checkInId, params.sessionType, 1);
    serviceSessions = resolved.length > 0 ? resolved : null;
  }

  const { data, error } = await supabase.rpc('consume_one_session', {
    p_package_id: params.packageId,
    p_session_type: params.sessionType,
    p_check_in_id: params.checkInId ?? null,
    p_session_date: params.sessionDate ?? null,
    p_performed_by: params.performedBy ?? null,
    p_treatment_started_at: params.treatmentStartedAt ?? null,
    p_treatment_ended_at: params.treatmentEndedAt ?? null,
    p_surcharge: params.surcharge ?? 0,
    p_surcharge_memo: params.surchargeMemo ?? null,
    p_service_sessions: serviceSessions,
  });

  if (error) return { result: null, error: error.message };
  const result = data as ConsumeOneSessionResult | null;
  if (result && result.ok === false) return { result, error: result.error ?? '회차 소진 실패' };
  return { result, error: null };
}
