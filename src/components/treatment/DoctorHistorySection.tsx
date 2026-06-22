// DoctorHistorySection.tsx — 치료테이블 §A '진료 환자 이력'
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-2/3)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER
//   A. 컴팩트 — 테이블 px/py·텍스트 축소(정보밀도 ↑).
//   B. 날짜필터 — 내부 date state 제거, 부모(TreatmentTable) 공통 날짜선택기의 `date` prop 사용(controlled).
//   D. 이름 인터랙션 — 좌클릭=2번차트 open / 우클릭=CRM 컨텍스트 메뉴(부모 nameInteraction 핸들러 위임).
//
// 리스트 기준: 선택 날짜 기준 원장 진료콜 명단에 등재된 이력이 있는 환자(내원).
//   진료콜 등재 = check_ins.status_flag IN ('purple'=진료필요, 'pink'=진료완료). (doctor-call-notify SSOT)
//
// 발행 O/X(원장 발행 여부) — read-only 재사용, 신규 스키마 0:
//   · 처방전  = check_ins.prescription_status='confirmed' AND doctor_confirm_prescription=true (그 내원 행).
//   · 소견·진단서 = form_submissions(status='published', field_data.doc_kind='opinion_doc') 존재(고객+발행일).

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import type { VisitType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Stethoscope, Users, Eye } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

interface DoctorHistoryRow {
  checkInId: string;
  customerId: string | null;
  customerName: string;
  chartNumber: string | null;
  visitType: string;
  checkedInAt: string;
  rxIssued: boolean;        // 처방전 발행 O/X
  opinionIssued: boolean;   // 소견·진단서 발행 O/X
}

function dayBounds(date: string) {
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` };
}

function useDoctorHistory(clinicId: string | null | undefined, date: string) {
  return useQuery<DoctorHistoryRow[]>({
    queryKey: ['doctor_history', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { start, end } = dayBounds(date);

      // 진료콜 등재 내원(status_flag purple|pink). 처방 발행 판정 컬럼 동반 read.
      const { data: ciData, error: ciErr } = await supabase
        .from('check_ins')
        .select(
          'id, customer_id, customer_name, visit_type, status_flag, status, checked_in_at, prescription_status, doctor_confirm_prescription',
        )
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .neq('status', 'cancelled')
        .in('status_flag', ['purple', 'pink'])
        .order('checked_in_at', { ascending: true });
      if (ciErr) {
        if (/status_flag|prescription_status|42703/.test(ciErr.message ?? '')) return [];
        throw ciErr;
      }
      const ciRows = (ciData ?? []) as Array<Record<string, unknown>>;
      if (ciRows.length === 0) return [];

      // 소견·진단서 발행본(form_submissions published, doc_kind='opinion_doc') — 해당 날짜·고객 집합.
      const custIds = [...new Set(ciRows.map((c) => String(c['customer_id'] ?? '')).filter(Boolean))];
      const publishedSet = new Set<string>();
      if (custIds.length > 0) {
        try {
          const { data: pub } = await supabase
            .from('form_submissions')
            .select('customer_id, field_data, created_at')
            .eq('clinic_id', clinicId)
            .eq('status', 'published')
            .eq('field_data->>doc_kind', 'opinion_doc')
            .in('customer_id', custIds)
            .gte('created_at', start)
            .lte('created_at', end);
          for (const r of (pub ?? []) as Array<Record<string, unknown>>) {
            const cid = String(r['customer_id'] ?? '');
            if (cid) publishedSet.add(cid);
          }
        } catch {
          // 발행본 조회 실패 — 소견·진단서 O/X 는 X 폴백(섹션 무파손).
        }
      }

      return ciRows.map((c) => {
        const cid = c['customer_id'] ? String(c['customer_id']) : null;
        const rxIssued =
          c['prescription_status'] === 'confirmed' && c['doctor_confirm_prescription'] === true;
        return {
          checkInId: String(c['id']),
          customerId: cid,
          customerName: String(c['customer_name'] ?? '—'),
          chartNumber: null,
          visitType: String(c['visit_type'] ?? ''),
          checkedInAt: String(c['checked_in_at'] ?? ''),
          rxIssued,
          opinionIssued: cid ? publishedSet.has(cid) : false,
        } as DoctorHistoryRow;
      });
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 차트번호 + 연락처 보강(read-only). 우클릭 메뉴 '예약하기' 프리필용 phone 동반(additive read).
interface CustMeta { chart: string | null; phone: string | null; }
function useCustomerMeta(clinicId: string | null | undefined, customerIds: string[]) {
  const key = [...new Set(customerIds)].sort().join(',');
  return useQuery<Map<string, CustMeta>>({
    queryKey: ['doctor_history_meta', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const m = new Map<string, CustMeta>();
      if (!clinicId || !key) return m;
      const { data } = await supabase
        .from('customers')
        .select('id, chart_number, phone')
        .in('id', key.split(','));
      for (const c of (data ?? []) as Array<{ id: string; chart_number: string | null; phone: string | null }>) {
        if (c.id) m.set(c.id, { chart: c.chart_number ?? null, phone: c.phone ?? null });
      }
      return m;
    },
    staleTime: 60_000,
  });
}

// 발행 O/X 배지.
function IssueBadge({ issued, testid }: { issued: boolean; testid: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        issued ? 'bg-emerald-50 text-emerald-700' : 'bg-muted/40 text-muted-foreground/60'
      }`}
      data-testid={testid}
      data-issued={issued ? 'true' : 'false'}
    >
      {issued ? '발행 O' : '발행 X'}
    </span>
  );
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function DoctorHistorySection({ date, nameInteraction }: Props) {
  const clinic = useClinic();

  const { data: rows = [], isLoading, isError, error } = useDoctorHistory(clinic?.id, date);
  const custIds = rows.map((r) => r.customerId).filter(Boolean) as string[];
  const { data: metaMap } = useCustomerMeta(clinic?.id, custIds);

  return (
    <div className="flex flex-col gap-3" data-testid="doctor-history-section">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Stethoscope className="h-4 w-4 text-teal-600" />
          진료 환자 이력
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          선택 날짜에 원장 진료콜 명단에 오른 환자입니다. 처방전·소견서/진단서 발행 여부를 표시합니다.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-6 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
          data-testid="doctor-history-empty"
        >
          <Users className="h-5 w-5 text-muted-foreground/40" />
          해당 날짜에 진료콜 명단에 오른 환자가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="doctor-history-table">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">접수</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">환자</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">방문</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">처방전</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">소견·진단서</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap text-center">문서 보기</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const anyIssued = r.rxIssued || r.opinionIssued;
                const meta = r.customerId ? metaMap?.get(r.customerId) : undefined;
                return (
                  <tr
                    key={r.checkInId}
                    className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    data-testid="doctor-history-row"
                  >
                    <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                      {r.checkedInAt ? format(new Date(r.checkedInAt), 'HH:mm') : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                      {/* D. 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
                        data-testid="dh-name-clickable"
                        onClick={() => nameInteraction.onLeftClick(r.customerId)}
                        onContextMenu={(e) =>
                          nameInteraction.onContextMenu(e, {
                            id: r.customerId ?? '',
                            name: r.customerName,
                            phone: meta?.phone ?? null,
                            visit_type: (r.visitType as 'new' | 'returning') || 'returning',
                          })
                        }
                      >
                        <span>{r.customerName}</span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                          {chartNoBadge(meta?.chart ?? null)}
                        </span>
                      </button>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge className="bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0">
                        {VISIT_TYPE_KO[r.visitType as VisitType] ?? r.visitType ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <IssueBadge issued={r.rxIssued} testid="dh-rx-issue" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <IssueBadge issued={r.opinionIssued} testid="dh-opinion-issue" />
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      {/* 뷰어 pending_decision(모달 vs 인라인) — 현장 confirm 후 빌드. 발행본 있을 때만 자리 노출(비활성). */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[11px]"
                        disabled
                        title={anyIssued ? '문서 뷰어 준비 중(현장 확인 후 제공)' : '발행된 문서 없음'}
                        data-testid="dh-view-btn"
                      >
                        <Eye className="h-3 w-3" />
                        {anyIssued ? '보기(준비중)' : '—'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        ※ 발행 문서 내용 보기(뷰어)는 표시 방식 확정 후 제공됩니다. 현재는 발행 여부(O/X)만 표시합니다.
      </p>
    </div>
  );
}
