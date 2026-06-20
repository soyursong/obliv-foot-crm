// ExamTargetsSection.tsx — 치료테이블 §B '균검사 & 피검사 대상자'
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-4)
//
// 리스트업: 2번차트 패키지탭에서 균검사(KOH)/피검사(혈액) 토글 ON 저장 → check_in_services 의
//   koh_requested / blood_test_requested boolean(=true) 인 환자. (BLOODTEST-TOGGLE-ADD / KOHTEST-LIFECYCLE
//   저장모델 SSOT 를 read-only 재사용 — 신규 스키마 0, ADDITIVE 소비.)
//
// UI 요건(AC-4, BLOCKING): 환자 1명 = 1행. 같은 행에 [균검사][피검사] 박스 나란히. 신청한 검사만 활성(●),
//   미신청은 비활성(○). ❌ 검사 항목별 별도 행 금지.
//
// 날짜: 검사 신청은 환자(최근 내원)에 걸리는 '대기 중' 플래그이므로 페이지 날짜 네비와 독립 — 현재 활성
//   신청 전체를 보여준다(KohReportTab '명단' 의미와 정합). 클리닉 스코프.
//
// 방어성: koh_requested/blood_test_requested 는 ADDITIVE(마이그 미적용 prod 도달 시 42703). 폴백 → 빈 목록.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge } from '@/lib/format';
import { Loader2, FlaskConical, Droplet, ClipboardList } from 'lucide-react';

interface ExamTargetRow {
  customerId: string;
  customerName: string;
  chartNumber: string | null;
  kohRequested: boolean;
  bloodRequested: boolean;
}

// check_in_services(koh_requested|blood_test_requested=true) → 환자별 집계(1환자 1행).
//   check_ins!inner 로 clinic/customer/이름/취소여부 제한. customers 조인으로 차트번호 보강.
function useExamTargets(clinicId: string | null | undefined) {
  return useQuery<ExamTargetRow[]>({
    queryKey: ['exam_targets', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const SEL =
        'id, koh_requested, blood_test_requested, check_in_id, ' +
        'check_ins!inner(customer_id, customer_name, clinic_id, status)';
      const { data, error } = await supabase
        .from('check_in_services')
        .select(SEL)
        .eq('check_ins.clinic_id', clinicId)
        .neq('check_ins.status', 'cancelled')
        .or('koh_requested.eq.true,blood_test_requested.eq.true');
      if (error) {
        // ADDITIVE 컬럼 미적용 prod(42703) → 빈 목록 폴백(페이지 무파손).
        if (/koh_requested|blood_test_requested|42703/.test(error.message ?? '')) return [];
        throw error;
      }

      // 환자별 집계 — 같은 환자의 여러 service 행을 OR 로 접어 1행.
      const map = new Map<string, ExamTargetRow>();
      for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const ci = (raw['check_ins'] ?? {}) as Record<string, unknown>;
        const cid = String(ci['customer_id'] ?? '');
        if (!cid) continue;
        const koh = raw['koh_requested'] === true;
        const blood = raw['blood_test_requested'] === true;
        if (!koh && !blood) continue;
        const prev = map.get(cid);
        if (prev) {
          prev.kohRequested = prev.kohRequested || koh;
          prev.bloodRequested = prev.bloodRequested || blood;
        } else {
          map.set(cid, {
            customerId: cid,
            customerName: String(ci['customer_name'] ?? '—'),
            chartNumber: null,
            kohRequested: koh,
            bloodRequested: blood,
          });
        }
      }

      const rows = [...map.values()];
      if (rows.length === 0) return [];

      // 차트번호 보강(read-only). 실패해도 목록은 표시(차트번호만 '#미발번').
      try {
        const ids = rows.map((r) => r.customerId);
        const { data: custs } = await supabase
          .from('customers')
          .select('id, chart_number')
          .in('id', ids);
        const chartMap = new Map<string, string>();
        for (const c of (custs ?? []) as Array<{ id: string; chart_number: string | null }>) {
          if (c.id && c.chart_number) chartMap.set(c.id, c.chart_number);
        }
        for (const r of rows) r.chartNumber = chartMap.get(r.customerId) ?? null;
      } catch {
        // 차트번호 보강 실패 — 무시(이름·검사상태는 정상 표시).
      }

      // 이름 정렬(안정적 표시).
      rows.sort((a, b) => a.customerName.localeCompare(b.customerName, 'ko'));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 검사 박스 — 신청(●, 활성색) / 미신청(○, 회색).
function ExamBadge({
  label,
  active,
  tone,
  testid,
}: {
  label: string;
  active: boolean;
  tone: 'teal' | 'rose';
  testid: string;
}) {
  const Icon = tone === 'teal' ? FlaskConical : Droplet;
  const onCls =
    tone === 'teal'
      ? 'border-teal-300 bg-teal-50 text-teal-700'
      : 'border-rose-300 bg-rose-50 text-rose-700';
  const offCls = 'border-muted bg-muted/30 text-muted-foreground/60';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${
        active ? onCls : offCls
      }`}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="text-[12px] leading-none">{active ? '●' : '○'}</span>
    </span>
  );
}

export default function ExamTargetsSection() {
  const clinic = useClinic();
  const { data: rows = [], isLoading, isError, error } = useExamTargets(clinic?.id);

  return (
    <div className="flex flex-col gap-4" data-testid="exam-targets-section">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-teal-600" />
            균검사 &amp; 피검사 대상자
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            2번차트 패키지탭에서 균검사·피검사를 신청(ON)한 환자 명단입니다. 신청한 검사만 활성(●)으로 표시됩니다.
          </p>
        </div>
        {rows.length > 0 && (
          <span
            className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700"
            data-testid="exam-targets-count"
          >
            대상 {rows.length}명
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-8 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground"
          data-testid="exam-targets-empty"
        >
          <ClipboardList className="h-6 w-6 text-muted-foreground/40" />
          균검사·피검사를 신청한 환자가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="exam-targets-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
                <th className="px-4 py-3 whitespace-nowrap">#</th>
                <th className="px-4 py-3 whitespace-nowrap">환자</th>
                <th className="px-4 py-3 whitespace-nowrap">신청 검사</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.customerId}
                  className="border-b last:border-0 transition-colors hover:bg-muted/30"
                  data-testid="exam-targets-row"
                >
                  <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{r.customerName}</span>
                      <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                        {chartNoBadge(r.chartNumber)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {/* AC-4: 한 행에 균검사·피검사 박스 나란히. 신청한 것만 활성. */}
                    <div className="flex items-center gap-2">
                      <ExamBadge label="균검사" active={r.kohRequested} tone="teal" testid="exam-koh-badge" />
                      <ExamBadge label="피검사" active={r.bloodRequested} tone="rose" testid="exam-blood-badge" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
