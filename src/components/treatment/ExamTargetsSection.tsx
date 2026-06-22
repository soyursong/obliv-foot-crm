// ExamTargetsSection.tsx — 치료테이블 §B '균검사 & 피검사 대상자'
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-4)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER
//   A. 컴팩트 — 테이블 px/py·텍스트 축소.
//   B. 날짜필터 — 부모 공통 날짜선택기 `date` prop 으로 해당 일자 신청만(check_ins.checked_in_at 범위) 필터.
//      (pending_decision: 탭 공통 vs 섹션 독립 → 총괄 confirm. 현재=탭 공통 골격.)
//   C. 검사결과 동행배치 — 각 행에 '검사신청' 상태 + '검사결과' 동작을 같은 줄에 배치.
//      · 발행된 KOH 결과 → '결과 보기'(KohResultDialog 재사용, read-after-write).
//      · 미발행 KOH      → '결과 생성' → 균검사 보고서(KohReportTab) 생성 동선 안내(기존 발행 surface 재사용).
//      · 혈액검사 결과   → ⚠ DISCOVERY: 결과 생성 백엔드(RPC/테이블) 부재 → '준비중' 비활성.
//        (publish_blood RPC / blood_result 템플릿 없음 — planner FOLLOWUP·data-architect CONSULT 필요. 신규 비즈로직.)
//   D. 이름 인터랙션 — 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴(부모 nameInteraction 위임).
//
// 리스트업: check_in_services 의 koh_requested / blood_test_requested=true 인 환자. (BLOODTEST-TOGGLE-ADD /
//   KOHTEST-LIFECYCLE SSOT read-only 재사용 — 신규 스키마 0, ADDITIVE 소비.) 환자 1명 = 1행.
// 방어성: koh_requested/blood_test_requested 는 ADDITIVE(마이그 미적용 prod 42703) → 폴백 빈 목록.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import KohResultDialog from '@/components/KohResultDialog';
import { Loader2, FlaskConical, Droplet, ClipboardList, FilePlus2, FileText } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

interface ExamTargetRow {
  customerId: string;
  customerName: string;
  chartNumber: string | null;
  phone: string | null;
  kohRequested: boolean;
  bloodRequested: boolean;
  kohServiceId: string | null; // C: 발행본(koh_service_id) lookup 키
}

function dayBounds(date: string) {
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` };
}

// check_in_services(koh_requested|blood_test_requested=true) → 환자별 집계(1환자 1행). B: 날짜 범위 필터.
function useExamTargets(clinicId: string | null | undefined, date: string) {
  return useQuery<ExamTargetRow[]>({
    queryKey: ['exam_targets', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { start, end } = dayBounds(date);
      const SEL =
        'id, koh_requested, blood_test_requested, check_in_id, ' +
        'check_ins!inner(customer_id, customer_name, clinic_id, status, checked_in_at)';
      const { data, error } = await supabase
        .from('check_in_services')
        .select(SEL)
        .eq('check_ins.clinic_id', clinicId)
        .neq('check_ins.status', 'cancelled')
        .gte('check_ins.checked_in_at', start)
        .lte('check_ins.checked_in_at', end)
        .or('koh_requested.eq.true,blood_test_requested.eq.true');
      if (error) {
        // ADDITIVE 컬럼 미적용 prod(42703) → 빈 목록 폴백(페이지 무파손).
        if (/koh_requested|blood_test_requested|42703/.test(error.message ?? '')) return [];
        throw error;
      }

      // 환자별 집계 — 같은 환자의 여러 service 행을 OR 로 접어 1행. koh service id 1건 보존(결과 lookup).
      const map = new Map<string, ExamTargetRow>();
      for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const ci = (raw['check_ins'] ?? {}) as Record<string, unknown>;
        const cid = String(ci['customer_id'] ?? '');
        if (!cid) continue;
        const koh = raw['koh_requested'] === true;
        const blood = raw['blood_test_requested'] === true;
        if (!koh && !blood) continue;
        const svcId = String(raw['id'] ?? '');
        const prev = map.get(cid);
        if (prev) {
          prev.kohRequested = prev.kohRequested || koh;
          prev.bloodRequested = prev.bloodRequested || blood;
          if (koh && !prev.kohServiceId) prev.kohServiceId = svcId || null;
        } else {
          map.set(cid, {
            customerId: cid,
            customerName: String(ci['customer_name'] ?? '—'),
            chartNumber: null,
            phone: null,
            kohRequested: koh,
            bloodRequested: blood,
            kohServiceId: koh ? svcId || null : null,
          });
        }
      }

      const rows = [...map.values()];
      if (rows.length === 0) return [];

      // 차트번호·연락처 보강(read-only). 실패해도 목록은 표시.
      try {
        const ids = rows.map((r) => r.customerId);
        const { data: custs } = await supabase
          .from('customers')
          .select('id, chart_number, phone')
          .in('id', ids);
        const metaMap = new Map<string, { chart: string | null; phone: string | null }>();
        for (const c of (custs ?? []) as Array<{ id: string; chart_number: string | null; phone: string | null }>) {
          if (c.id) metaMap.set(c.id, { chart: c.chart_number ?? null, phone: c.phone ?? null });
        }
        for (const r of rows) {
          const meta = metaMap.get(r.customerId);
          r.chartNumber = meta?.chart ?? null;
          r.phone = meta?.phone ?? null;
        }
      } catch {
        // 보강 실패 — 무시(이름·검사상태는 정상 표시).
      }

      rows.sort((a, b) => a.customerName.localeCompare(b.customerName, 'ko'));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// C: 발행된 KOH 결과지 인덱스(koh_service_id → field_data). KohReportTab usePublishedKoh 와 동일 SSOT read-only.
function usePublishedKohMap(clinicId: string | null | undefined) {
  return useQuery<Map<string, Record<string, unknown>>>({
    queryKey: ['koh_published', clinicId], // KohReportTab 와 동일 키 — 발행 시 invalidate 공유(read-after-write).
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, Record<string, unknown>>();
      if (!clinicId) return map;
      const { data: tpl } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'koh_result')
        .limit(1)
        .maybeSingle();
      if (!tpl?.id) return map;
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data')
        .eq('clinic_id', clinicId)
        .eq('template_id', tpl.id)
        .eq('status', 'published');
      if (error) throw error;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
        const sid = String(fd['koh_service_id'] ?? '');
        if (sid) map.set(sid, fd);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
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
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
        active ? onCls : offCls
      }`}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
    >
      <Icon className="h-3 w-3" />
      {label}
      <span className="text-[12px] leading-none">{active ? '●' : '○'}</span>
    </span>
  );
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function ExamTargetsSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError, error } = useExamTargets(clinic?.id, date);
  const { data: publishedKoh } = usePublishedKohMap(clinic?.id);
  const [viewFieldData, setViewFieldData] = useState<Record<string, unknown> | null>(null);

  // C: 미발행 KOH 결과 생성 — 기존 발행 surface(균검사 보고서) 재사용 안내(인라인 publish UX 는 pending_decision).
  const goGenerateKoh = () => {
    toast('균검사 보고서(의사 도구)에서 결과를 생성·발행하세요.');
    navigate('/admin/doctor-tools');
  };

  return (
    <div className="flex flex-col gap-3" data-testid="exam-targets-section">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-teal-600" />
            균검사 &amp; 피검사 대상자
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            선택 날짜에 균검사·피검사를 신청(ON)한 환자 명단입니다. 신청한 검사만 활성(●)으로 표시됩니다.
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
          data-testid="exam-targets-empty"
        >
          <ClipboardList className="h-5 w-5 text-muted-foreground/40" />
          해당 날짜에 균검사·피검사를 신청한 환자가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="exam-targets-table">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">환자</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">신청 검사 &amp; 검사결과</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const kohFd = r.kohServiceId ? publishedKoh?.get(r.kohServiceId) : undefined;
                const kohPublished = !!kohFd;
                return (
                  <tr
                    key={r.customerId}
                    className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    data-testid="exam-targets-row"
                  >
                    <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                      {/* D. 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
                        data-testid="exam-name-clickable"
                        onClick={() => nameInteraction.onLeftClick(r.customerId)}
                        onContextMenu={(e) =>
                          nameInteraction.onContextMenu(e, {
                            id: r.customerId,
                            name: r.customerName,
                            phone: r.phone,
                          })
                        }
                      >
                        <span>{r.customerName}</span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                          {chartNoBadge(r.chartNumber)}
                        </span>
                      </button>
                    </td>
                    {/* C: 신청 상태 + 검사결과 동작을 같은 줄에(AC-3). 검사별로 [상태 박스 | 결과 동작] 묶음. */}
                    <td className="px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {/* 균검사 */}
                        <div className="flex items-center gap-1.5" data-testid="exam-koh-group">
                          <ExamBadge label="균검사" active={r.kohRequested} tone="teal" testid="exam-koh-badge" />
                          {r.kohRequested &&
                            (kohPublished ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 gap-1 px-1.5 text-[11px]"
                                data-testid="exam-koh-result-view"
                                onClick={() => setViewFieldData(kohFd!)}
                                title="발행된 균검사 결과 보기"
                              >
                                <FileText className="h-3 w-3" /> 결과 보기
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                className="h-6 gap-1 px-1.5 text-[11px] bg-teal-600 text-white hover:bg-teal-700"
                                data-testid="exam-koh-result-new"
                                onClick={goGenerateKoh}
                                title="균검사 결과 생성(균검사 보고서로 이동)"
                              >
                                <FilePlus2 className="h-3 w-3" /> 결과 생성
                              </Button>
                            ))}
                        </div>
                        {/* 피검사 — 결과 생성 백엔드 부재(DISCOVERY): '준비중' 비활성 */}
                        <div className="flex items-center gap-1.5" data-testid="exam-blood-group">
                          <ExamBadge label="피검사" active={r.bloodRequested} tone="rose" testid="exam-blood-badge" />
                          {r.bloodRequested && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 gap-1 px-1.5 text-[11px]"
                              data-testid="exam-blood-result-new"
                              disabled
                              title="혈액검사 결과 생성 동선 준비 중(개발 협의)"
                            >
                              <FilePlus2 className="h-3 w-3" /> 결과(준비중)
                            </Button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* C: 발행된 KOH 결과지 보기 — 기존 KohResultDialog 재사용(read). */}
      <KohResultDialog
        open={viewFieldData !== null}
        onOpenChange={(v) => { if (!v) setViewFieldData(null); }}
        fieldData={viewFieldData}
      />
    </div>
  );
}
