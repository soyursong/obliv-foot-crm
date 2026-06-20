// DocRequestQueue — 진료대시보드 '서류작성' 탭: 실장(데스크)이 보낸 소견서/진단서 발행 요청 큐(원장영역).
// Ticket: T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK (AC-3/9/10/11)
//   AC-11 9컬럼: 이름 / 생년 / 차트번호 / 오늘시술 / 처방내역 / 임상경과 / 서류종류 / 해당항목 / 발행.
//   AC-9 '작성하기' 버튼 + 반짝효과(신규 요청 시각화). AC-10 작성하기 → 좌측 prefill + 메모(실장 요청 참고).
//
// ★authoring 경계(AC-4, BLOCKING): 본 큐는 요청(draft) 표시 + 원장이 '작성하기'로 발행창을 여는 진입점일 뿐.
//   발행 본문 작성·확정은 OpinionEditorDialog → publish_opinion_doc RPC(is_doctor_role 게이트)로만 — 큐는 발행하지 않는다.

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { birthYearAgeDisplay, chartNoDisplay } from '@/lib/format';
import {
  useOpinionRequestQueue,
  useResolveOpinionRequest,
  useQueueClinicalSnaps,
  buildOptionLabelMap,
  docTypeLabel,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
import {
  OpinionEditorDialog,
  useClinicHeader,
  type VisitorRow,
} from '@/components/doctor/OpinionDocTab';
import { Button } from '@/components/ui/button';
import { Loader2, FilePen, Sparkles, Inbox } from 'lucide-react';

export default function DocRequestQueue() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const { data: rows = [], isLoading, isError, error } = useOpinionRequestQueue(clinicId);
  const { data: clinicHeader = null } = useClinicHeader(clinicId);
  const resolveMut = useResolveOpinionRequest(clinicId);

  const customerIds = useMemo(() => rows.map((r) => r.customerId).filter(Boolean) as string[], [rows]);
  const { data: clinicalSnaps = {} } = useQueueClinicalSnaps(clinicId, customerIds);
  const labelMap = useMemo(() => buildOptionLabelMap(), []);

  const [active, setActive] = useState<OpinionRequestRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openWrite = (r: OpinionRequestRow) => {
    setActive(r);
    setDialogOpen(true);
  };

  // 큐 행 → OpinionEditorDialog visitor 구성. id=check_in_id(발행 앵커). 없으면 발행 불가 안내.
  const activeVisitor: VisitorRow | null = active
    ? {
        id: active.checkInId ?? '',
        customer_id: active.customerId,
        customer_name: active.patientName,
        chart_number: active.chartNo,
        birth_date: active.birthDate,
        visit_type: null,
        checked_in_at: active.createdAt,
      }
    : null;

  const handlePublished = async () => {
    if (!active) return;
    try {
      await resolveMut.mutateAsync({ requestId: active.id, reason: 'published' });
    } catch {
      // resolve 실패해도 발행본은 정상 생성됨 — 다음 폴링/새로고침 시 재시도 가능. 사용자 차단 없음.
    }
  };

  const labelsOf = (keys: string[]) =>
    keys.map((k) => labelMap.get(k)).filter(Boolean).join(', ');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <FilePen className="h-4 w-4 text-teal-600" />
            서류작성 요청
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            데스크(실장)에서 보낸 소견서·진단서 발행 요청입니다. [작성하기]를 누르면 선택 항목이 미리 채워진 발행 창이 열립니다.
          </p>
        </div>
        {rows.length > 0 && (
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700" data-testid="docreq-count">
            대기 {rows.length}건
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-8 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground" data-testid="docreq-empty">
          <Inbox className="h-6 w-6 text-muted-foreground/50" />
          데스크에서 보낸 발행 요청이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="docreq-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">이름</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">생년(만나이)</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">차트번호</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">오늘시술</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">처방내역</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">임상경과</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">서류종류</th>
                <th className="px-2 py-1.5 font-medium">해당항목</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap text-center">발행</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const snap = r.customerId ? clinicalSnaps[r.customerId] : undefined;
                return (
                  <tr key={r.id} className="border-b last:border-0 align-top transition hover:bg-accent/30" data-testid="docreq-row">
                    <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-foreground" data-testid="docreq-cell-name">
                      {r.patientName}
                      {r.requestedByName && (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">· 요청 {r.requestedByName}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-foreground/90">{birthYearAgeDisplay(r.birthDate) || '—'}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap text-foreground/90">{r.chartNo ? chartNoDisplay(r.chartNo) : '—'}</td>
                    <td className="px-2 py-1.5 max-w-[10rem] text-foreground/80"><span className="block truncate" title={snap?.treatment ?? ''}>{snap?.treatment || '—'}</span></td>
                    <td className="px-2 py-1.5 text-muted-foreground">—</td>
                    <td className="px-2 py-1.5 max-w-[10rem] text-foreground/80"><span className="block truncate" title={snap?.progress ?? ''}>{snap?.progress || '—'}</span></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">{docTypeLabel(r.docType)}</span>
                    </td>
                    <td className="px-2 py-1.5 text-foreground/80" data-testid="docreq-cell-items">
                      <span className="block max-w-[16rem] truncate" title={labelsOf(r.selectedKeys)}>{labelsOf(r.selectedKeys) || '—'}</span>
                      {r.staffMemo && (
                        <span className="mt-0.5 block max-w-[16rem] truncate text-[10px] text-teal-700/80" title={r.staffMemo}>메모: {r.staffMemo}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      {/* AC-9 반짝효과: 신규 요청 시각화. AC-10 작성하기 → prefill 발행창. */}
                      <span className="relative inline-flex">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-md bg-teal-400/40" aria-hidden />
                        <Button
                          size="sm"
                          className="relative h-7 gap-1 bg-teal-600 px-2.5 text-[11px] text-white hover:bg-teal-700"
                          onClick={() => openWrite(r)}
                          data-testid="docreq-write-btn"
                        >
                          <Sparkles className="h-3 w-3" /> 작성하기
                        </Button>
                      </span>
                      {!r.checkInId && (
                        <span className="mt-0.5 block text-[9px] text-amber-600" title="내원 이력이 없어 발행 전 내원 확인이 필요합니다.">내원확인 필요</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        ※ 데스크에서 보낸 요청 목록입니다. [작성하기]를 누르면 실장이 고른 항목이 미리 선택된 발행 창이 열리며, 내용을 확인·수정한 뒤 원장님이 직접 발행합니다(발행은 원장 권한). 발행이 완료되면 해당 요청은 목록에서 사라집니다.
      </p>

      {/* AC-10: prefill 발행창 — initialSelectedKeys/docType/staffMemo 전달, 발행 성공 시 요청 resolve(큐 제거). */}
      <OpinionEditorDialog
        visitor={activeVisitor}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clinicId={clinicId}
        profile={profile}
        clinicHeader={clinicHeader}
        initialSelectedKeys={active?.selectedKeys ?? []}
        initialDocType={active?.docType ?? 'opinion'}
        staffRequestMemo={active?.staffMemo ?? null}
        requestId={active?.id ?? null}
        onPublished={handlePublished}
      />
    </div>
  );
}
