// T-20260822-foot-CLOSING-TXMEMO-MISSING-ALERT (기능 B, 김주연 총괄 field-decided)
//
// '회차 차감됐으나 특이사항(치료메모) 미작성' 판정 — read-only, db_change=false.
//
// [AC0 feasibility 결과 — canonical 소스 확정]
//   특이사항(치료메모)의 canonical 저장처 = customer_treatment_memos.
//   (MedicalChartPanel / CustomerChartPage / progressAnalysisMd / TreatmentMemoComposer 전부 이 테이블 사용)
//   fuller-spec 의 customers.special_notes / customer_special_notes 는 person-grain(마이그 주석:
//   "날짜별 분기 없이 공용 누적")이라 '방문일별 미작성' 을 담을 수 없어 canonical 자격 REJECT.
//
// [join grain — customer × 영업일(date)]
//   차감이벤트 package_sessions(status='used', deleted_at IS NULL, session_date=date, packages→customer_id)
//   ↔ 해당 customer 의 customer_treatment_memos(created_at::date=date[Asia/Seoul], deleted_at IS NULL) 부재.
//   customer_treatment_memos 에 방문/체크인 FK 가 없어 최선 grain = (customer_id, 영업일). memo 내용은 read
//   하지 않고 '존재여부' 만 판정 → 신규 PHI read 경계 없음. 두 테이블 모두 기존 clinic-scoped RLS 내.
//
// [작성됨 판정 memo_type]
//   현장 표현 "특이사항(치료메모)" = 치료 후 남기는 메모. 치료측 유형 2종(치료메모·특이사항) 중 하나라도
//   당일 존재하면 '작성됨'. 진료메모(의사측)는 별개라 제외. (필요시 planner 재확인 후 상수만 조정.)
import { supabase } from './supabase';

/** '작성됨' 으로 인정하는 치료측 memo_type (진료메모=의사측은 제외). */
export const TX_MEMO_WRITTEN_TYPES = ['치료메모', '특이사항'] as const;

export interface TxMemoMissingCustomer {
  customer_id: string;
  name: string;
  chart_number: string | null;
  /** 당일 차감된 치료종류(중복 제거·표시용). */
  session_types: string[];
}

export interface TxMemoMissingResult {
  count: number;
  customers: TxMemoMissingCustomer[];
}

/** date(yyyy-MM-dd) 을 Asia/Seoul 영업일 경계 [start, end) 로 변환. created_at(timestamptz) 필터용. */
function seoulDayBounds(date: string): { start: string; end: string } {
  // date 를 KST 자정 기준으로 잡고 +1일. UTC offset +09:00 명시로 서버 TZ 무관 안정.
  const start = `${date}T00:00:00+09:00`;
  const next = new Date(`${date}T00:00:00+09:00`);
  next.setDate(next.getDate() + 1);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  const end = `${y}-${m}-${d}T00:00:00+09:00`;
  return { start, end };
}

/**
 * 마감 영업일(date)에 회차가 차감됐으나 치료메모가 없는 고객 목록을 반환한다.
 * read-only. 실패(권한/네트워크)는 빈 결과로 graceful degrade(배너 미노출) — money-path 영향 없음.
 */
export async function fetchTxMemoMissing(
  clinicId: string | null | undefined,
  date: string,
): Promise<TxMemoMissingResult> {
  if (!clinicId || !date) return { count: 0, customers: [] };

  // 1) 당일 차감(used) 세션 → 고객·치료종류 수집.
  //    packages→customers FK 2개(customer_id·transferred_to) 모호 회피 위해 packages_customer_id_fkey 명시.
  const { data: sessions, error: sErr } = await supabase
    .from('package_sessions')
    .select(`
      session_type, session_date,
      packages!inner(
        clinic_id, customer_id,
        customers!packages_customer_id_fkey(id, name, chart_number)
      )
    `)
    .eq('packages.clinic_id', clinicId)
    .eq('status', 'used')
    .is('deleted_at', null)
    .gte('session_date', date)
    .lte('session_date', date);
  if (sErr || !sessions) return { count: 0, customers: [] };

  // customer_id → { name, chart_number, session_types }
  const byCust = new Map<string, TxMemoMissingCustomer>();
  for (const row of sessions as unknown as Array<{
    session_type: string | null;
    packages: { customer_id: string | null; customers: { id: string; name: string | null; chart_number: string | null } | null } | null;
  }>) {
    const cust = row.packages?.customers;
    const cid = cust?.id ?? row.packages?.customer_id ?? null;
    if (!cid) continue;
    const entry = byCust.get(cid) ?? {
      customer_id: cid,
      name: cust?.name ?? '(이름 미상)',
      chart_number: cust?.chart_number ?? null,
      session_types: [],
    };
    if (row.session_type && !entry.session_types.includes(row.session_type)) {
      entry.session_types.push(row.session_type);
    }
    byCust.set(cid, entry);
  }
  if (byCust.size === 0) return { count: 0, customers: [] };

  // 2) 당일 치료메모 작성된 고객 집합 조회(존재여부만).
  const custIds = Array.from(byCust.keys());
  const { start, end } = seoulDayBounds(date);
  const writtenSet = new Set<string>();
  // IN 청크(URL 길이 방어) — 200개씩.
  for (let i = 0; i < custIds.length; i += 200) {
    const slice = custIds.slice(i, i + 200);
    const { data: memos, error: mErr } = await supabase
      .from('customer_treatment_memos')
      .select('customer_id')
      .in('customer_id', slice)
      .in('memo_type', TX_MEMO_WRITTEN_TYPES as unknown as string[])
      .is('deleted_at', null)
      .gte('created_at', start)
      .lt('created_at', end);
    if (mErr) return { count: 0, customers: [] }; // 판정 신뢰 불가 → 배너 미노출(과알림 방지)
    for (const m of (memos ?? []) as Array<{ customer_id: string | null }>) {
      if (m.customer_id) writtenSet.add(m.customer_id);
    }
  }

  // 3) 차감 O · 메모 X = 미작성.
  const customers = custIds
    .filter((cid) => !writtenSet.has(cid))
    .map((cid) => byCust.get(cid)!)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return { count: customers.length, customers };
}
