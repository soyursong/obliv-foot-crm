// DocRequestQueue — 진료대시보드 '서류작성' 탭: 실장(데스크)이 보낸 소견서/진단서 발행 요청 큐(원장영역).
// Ticket: T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK (AC-3/9/10/11)
//   AC-11 9컬럼: 이름 / 생년 / 차트번호 / 오늘시술 / 처방내역 / 임상경과 / 서류종류 / 해당항목 / 발행.
//   AC-9 '작성하기' 버튼 + 반짝효과(신규 요청 시각화). AC-10 작성하기 → 좌측 prefill + 메모(실장 요청 참고).
//
// ★authoring 경계(AC-4, BLOCKING): 본 큐는 요청(draft) 표시 + 원장이 '작성하기'로 발행창을 여는 진입점일 뿐.
//   발행 본문 작성·확정은 OpinionEditorDialog → publish_opinion_doc RPC(is_doctor_role 게이트)로만 — 큐는 발행하지 않는다.
//
// T-20260622-foot-MEDDOC-DASHBOARD-BADGE: embedded prop — 진료 알림판(DoctorCallDashboard) 상시뷰에 재사용 시
//   상위 섹션이 자체 '소견서·진단서 처리대기 N건' 헤더/뱃지를 그리므로 내부 헤더 블록을 숨겨 중복 제거.
//   default(false) = 서류작성 탭 기존 동선 그대로(회귀 0). 데이터 경로·테이블·필터 불변.

import { useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { birthYearAgeDisplay, chartNoDisplay } from '@/lib/format';
import {
  useOpinionRequestQueue,
  useResolveOpinionRequest,
  useQueueClinicalSnaps,
  buildOptionLabelMap,
  docTypeLabel,
  type ClinicalSnap,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
import {
  OpinionEditorDialog,
  useClinicHeader,
  type VisitorRow,
} from '@/components/doctor/OpinionDocTab';
// T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: 처방내역·임상경과 = RXCLIN-PREVIEW-DROPDOWN 표현 상속(미리보기 셀 클릭→컬럼-앵커 드롭다운 전문). 공유 컴포넌트 재사용(중복 재구현 금지).
import { ColumnExpandPopover } from '@/components/doctor/ColumnExpandPopover';
import { Button } from '@/components/ui/button';
import { Loader2, FilePen, Sparkles, Inbox } from 'lucide-react';

export default function DocRequestQueue({ embedded = false }: { embedded?: boolean } = {}) {
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
      {!embedded && (
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
      )}

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
              {rows.map((r) => (
                <DocRequestRow
                  key={r.id}
                  r={r}
                  snap={r.customerId ? clinicalSnaps[r.customerId] : undefined}
                  itemLabels={labelsOf(r.selectedKeys)}
                  onWrite={openWrite}
                />
              ))}
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

// ─── 서류요청 큐 1행 ─────────────────────────────────────────────────────────
//   T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: 처방내역·임상경과 = RXCLIN-PREVIEW-DROPDOWN 표현 상속.
//     셀은 '최신 1줄 미리보기'(truncate)이고, 클릭하면 셀 바로 아래 컬럼-앵커 드롭다운(ColumnExpandPopover)으로
//     전문을 펼쳐 읽는다(다른 컬럼 비가림·재클릭/바깥클릭 접힘). DoctorCallDashboard와 동일 컴포넌트 재사용(중복 재구현 금지).
//   내용 없으면('—') 비클릭(드롭다운 없음). 행 자체 ref/state 소유(DoctorCallDashboard CompletedRow 패턴).
function DocRequestRow({
  r,
  snap,
  itemLabels,
  onWrite,
}: {
  r: OpinionRequestRow;
  snap: ClinicalSnap | undefined;
  itemLabels: string;
  onWrite: (r: OpinionRequestRow) => void;
}) {
  const rxCellRef = useRef<HTMLTableCellElement>(null);
  const clinicalCellRef = useRef<HTMLTableCellElement>(null);
  const [expandRx, setExpandRx] = useState(false);
  const [expandClinical, setExpandClinical] = useState(false);

  const rx = snap?.prescription || null;
  const progress = snap?.progress || null;

  return (
    <>
    <tr className="border-b last:border-0 align-top transition hover:bg-accent/30" data-testid="docreq-row">
      <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-foreground" data-testid="docreq-cell-name">
        {r.patientName}
        {r.requestedByName && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">· 요청 {r.requestedByName}</span>
        )}
      </td>
      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-foreground/90">{birthYearAgeDisplay(r.birthDate) || '—'}</td>
      <td className="px-2 py-1.5 font-mono whitespace-nowrap text-foreground/90">{r.chartNo ? chartNoDisplay(r.chartNo) : '—'}</td>
      <td className="px-2 py-1.5 max-w-[10rem] text-foreground/80"><span className="block truncate" title={snap?.treatment ?? ''}>{snap?.treatment || '—'}</span></td>

      {/* 처방내역 ← medical_charts.prescription_items. RXCLIN 표현 상속: 미리보기 클릭 → 컬럼 폭 드롭다운 전문(widthScale=2, DoctorCallDashboard와 동일). */}
      <td
        ref={rxCellRef}
        className={`px-2 py-1.5 max-w-[10rem] text-foreground/80 ${rx ? 'cursor-pointer hover:text-teal-700' : ''}`}
        data-testid="docreq-cell-rx"
        onClick={rx ? () => setExpandRx((v) => !v) : undefined}
        title={rx ? '클릭하면 처방 전문을 펼쳐 봅니다.' : undefined}
      >
        <span className="block truncate">{rx || '—'}</span>
      </td>

      {/* 임상경과 ← chief_complaint || diagnosis. RXCLIN 표현 상속(widthScale=1). */}
      <td
        ref={clinicalCellRef}
        className={`px-2 py-1.5 max-w-[10rem] text-foreground/80 ${progress ? 'cursor-pointer hover:text-teal-700' : ''}`}
        data-testid="docreq-cell-clinical"
        onClick={progress ? () => setExpandClinical((v) => !v) : undefined}
        title={progress ? '클릭하면 임상경과 전문을 펼쳐 봅니다.' : undefined}
      >
        <span className="block truncate">{progress || '—'}</span>
      </td>

      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">{docTypeLabel(r.docType)}</span>
      </td>
      <td className="px-2 py-1.5 text-foreground/80" data-testid="docreq-cell-items">
        <span className="block max-w-[16rem] truncate" title={itemLabels}>{itemLabels || '—'}</span>
        {r.staffMemo && (
          /* Q2 fallback(non-blocking): 직원 서류요청 메모 = 단방향 read-display(양방향 편집·외부연동 미구현). */
          <span className="mt-0.5 block max-w-[16rem] truncate text-[10px] text-teal-700/80" title={r.staffMemo} data-testid="docreq-cell-memo">메모: {r.staffMemo}</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center whitespace-nowrap">
        {/* AC-9 반짝효과: 신규 요청 시각화. AC-10 작성하기 → prefill 발행창(원장/작성권한자만 본문, OpinionEditorDialog canPublish 게이트). */}
        <span className="relative inline-flex">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-md bg-teal-400/40" aria-hidden />
          <Button
            size="sm"
            className="relative h-7 gap-1 bg-teal-600 px-2.5 text-[11px] text-white hover:bg-teal-700"
            onClick={() => onWrite(r)}
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

    {/* 처방내역 전문 펼침(컬럼-앵커, RXCLIN과 동일 표현). 팝오버는 portal 렌더 → <tr> 형제로 배치(DoctorCallDashboard 패턴). */}
    <ColumnExpandPopover
      open={expandRx && !!rx}
      anchorRef={rxCellRef}
      onClose={() => setExpandRx(false)}
      testId="docreq-rx-expand-pop"
      widthScale={2}
    >
      <div className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-relaxed text-gray-700" data-testid="docreq-rx-expand">
        {rx}
      </div>
    </ColumnExpandPopover>

    {/* 임상경과 전문 펼침(컬럼-앵커, RXCLIN과 동일 표현) */}
    <ColumnExpandPopover
      open={expandClinical && !!progress}
      anchorRef={clinicalCellRef}
      onClose={() => setExpandClinical(false)}
      testId="docreq-clinical-expand-pop"
    >
      <div className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-relaxed text-gray-700" data-testid="docreq-clinical-expand">
        {progress}
      </div>
    </ColumnExpandPopover>
    </>
  );
}
