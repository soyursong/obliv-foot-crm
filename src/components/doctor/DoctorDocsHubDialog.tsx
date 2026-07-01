// DoctorDocsHubDialog — 진료대시보드 행에서 진입하는 '서류 발급 허브'
// Ticket: T-20260617-foot-DOCFORM-POPUP-OVERHAUL (Phase 1 — 진료대시보드 원장영역 연동, approved)
//
// 목적(AC-1): 진료 알림판/완료 각 내원객 행에서 원장 기입 서류(소견서·진단서/서류발급·검사결과지 KOH)를
//   탭 이동 없이 대시보드에서 바로 작성·발급할 수 있게 단일 진입점(서류 버튼)으로 일원화.
//
// 설계 원칙 — '얹기'(REDEFINITION 금지) + 기존 SSOT 컴포넌트 순수 재사용(회귀 0):
//   · 소견서      = OpinionDocTab.OpinionEditorDialog 재사용(publish_opinion_doc RPC·published 비가역 트리거·printOpinionDoc).
//   · 서류발급    = DocumentPrintPanel 재사용(진단서/진료확인서/통원확인서/진료의뢰서 등, L-006 4경로 SSOT 그대로).
//   · 검사결과지  = KohPublishedResults 재사용(발행된 KOH 결과지 조회·인쇄, 입력은 균검사지 탭 KohRequest 유지).
//   → 본 파일은 위 3개 surface를 '진입'만 시키는 얇은 컨테이너. 발행/출력/불변 로직은 각 컴포넌트 내부에 그대로 둠.
//
// 가드:
//   · published 불변 트리거(의료법§22) = 각 컴포넌트 내부에서 보존(본 파일은 신규 mutation 0).
//   · LOGIC-LOCK L-006(bindHtmlTemplate 4출력경로) = 미변경(DocumentPrintPanel/printOpinionDoc 재사용만).
//   · 기존 탭 경로(균검사지/소견서/1번차트 서류발급/2번차트) 병행 보존 = 본 진입점은 추가일 뿐 제거 없음(AC-8).
//   · 신규 DB 컬럼/스키마 변경 0 → data-architect CONSULT 게이트 비해당.
//
// 단일 Dialog 동시 오픈 보장: activeDoc 상태로 (허브 메뉴 ↔ 개별 서류 팝업) 1개만 열림(중첩 DOM 없음).
//   개별 서류 팝업을 닫으면 허브 메뉴로 복귀 → 허브 메뉴를 닫으면 전체 종료(parent onOpenChange(false)).

import { useEffect, useState } from 'react';
import { FileText, FileSignature, FlaskConical, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
import KohPublishedResults from '@/components/KohPublishedResults';
import { OpinionEditorDialog, useClinicHeader, type VisitorRow } from '@/components/doctor/OpinionDocTab';
import { chartNoDisplay } from '@/lib/format';
import type { CheckIn, UserProfile } from '@/lib/types';

type DocKind = 'opinion' | 'print' | 'koh';

// check_ins(임베드 customers) → 소견서 팝업 입력(VisitorRow) 매핑. read-only 파생, DB 무변경.
//   PostgREST 임베드는 object|array 양쪽 직렬화 가능 → 둘 다 흡수(DoctorCallDashboard.readChartNo 패턴 동일).
function visitorFromCheckIn(ci: CheckIn): VisitorRow {
  const raw = ci.customers as
    | { chart_number?: string | null; birth_date?: string | null }
    | Array<{ chart_number?: string | null; birth_date?: string | null }>
    | null
    | undefined;
  const c = Array.isArray(raw) ? raw[0] : raw;
  return {
    id: ci.id,
    customer_id: ci.customer_id ?? null,
    customer_name: ci.customer_name ?? '—',
    chart_number: c?.chart_number ?? null,
    birth_date: c?.birth_date ?? null,
    visit_type: ci.visit_type ?? null,
    checked_in_at: ci.checked_in_at ?? '',
  };
}

export default function DoctorDocsHubDialog({
  checkIn,
  open,
  onOpenChange,
  clinicId,
  profile,
  onRefresh,
}: {
  checkIn: CheckIn | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clinicId: string | null;
  profile: UserProfile | null;
  onRefresh?: () => void;
}) {
  const [activeDoc, setActiveDoc] = useState<DocKind | null>(null);
  const { data: clinicHeader = null } = useClinicHeader(clinicId);

  // 허브가 닫히거나 대상 환자가 바뀌면 항상 메뉴(activeDoc=null)에서 시작 — 직전 서류 잔상 방지.
  useEffect(() => {
    if (!open) setActiveDoc(null);
  }, [open]);
  useEffect(() => {
    setActiveDoc(null);
  }, [checkIn?.id]);

  const visitor = checkIn ? visitorFromCheckIn(checkIn) : null;
  const patientLabel = visitor
    ? `${visitor.customer_name}${visitor.chart_number ? ` · ${chartNoDisplay(visitor.chart_number)}` : ''}`
    : '';

  // DocumentPrintPanel은 checkIn.clinic_id를 다수 쿼리에 사용하나, 대시보드 CALL_SELECT는 clinic_id 미선택.
  //   단일 지점(profile.clinic_id)이며 피드는 clinic_id=eq.clinicId로 필터되므로 주입이 곧 정확값.
  const printCheckIn = checkIn ? ({ ...checkIn, clinic_id: checkIn.clinic_id ?? clinicId ?? '' } as CheckIn) : null;

  return (
    <>
      {/* 허브 메뉴 — 4서류 진입(소견서·서류발급·검사결과지). activeDoc 선택 시 메뉴 숨고 개별 팝업으로 전환. */}
      <Dialog
        open={open && activeDoc === null}
        onOpenChange={(v) => {
          if (!v) onOpenChange(false);
        }}
      >
        <DialogContent className="max-w-lg" data-testid="docs-hub-dialog">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-teal-600" />
            서류 발급
            {visitor && <span className="text-sm font-normal text-muted-foreground">· {patientLabel}</span>}
          </DialogTitle>
          <div className="mt-2 flex flex-col gap-3">
            <HubButton
              testId="docs-hub-opinion"
              icon={<FileSignature className="h-4 w-4 text-teal-600" />}
              title="소견서 작성·발행"
              onClick={() => setActiveDoc('opinion')}
            />
            <HubButton
              testId="docs-hub-print"
              icon={<FileText className="h-4 w-4 text-indigo-600" />}
              title="서류 발급 (진단서·진료확인서·통원확인서·진료의뢰서 등)"
              onClick={() => setActiveDoc('print')}
            />
            <HubButton
              testId="docs-hub-koh"
              icon={<FlaskConical className="h-4 w-4 text-emerald-600" />}
              title="검사결과지 (KOH 균검사)"
              onClick={() => setActiveDoc('koh')}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 소견서 — OpinionDocTab.OpinionEditorDialog 재사용(발행·출력·비가역 로직 그대로) */}
      <OpinionEditorDialog
        visitor={visitor}
        open={open && activeDoc === 'opinion'}
        onOpenChange={(v) => {
          if (!v) setActiveDoc(null);
        }}
        clinicId={clinicId}
        profile={profile}
        clinicHeader={clinicHeader}
      />

      {/* 서류 발급 — DocumentPrintPanel 재사용(L-006 4출력경로 SSOT 그대로) */}
      <Dialog
        open={open && activeDoc === 'print'}
        onOpenChange={(v) => {
          if (!v) setActiveDoc(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto" data-testid="docs-hub-print-dialog">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-600" />
            서류 발급
            {visitor && <span className="text-sm font-normal text-muted-foreground">· {patientLabel}</span>}
          </DialogTitle>
          {printCheckIn && <DocumentPrintPanel checkIn={printCheckIn} onUpdated={() => onRefresh?.()} />}
        </DialogContent>
      </Dialog>

      {/* 검사결과지 — KohPublishedResults 재사용(발행본만 표시, 없으면 안내) */}
      <Dialog
        open={open && activeDoc === 'koh'}
        onOpenChange={(v) => {
          if (!v) setActiveDoc(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="docs-hub-koh-dialog">
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-emerald-600" />
            검사결과지 (KOH)
            {visitor && <span className="text-sm font-normal text-muted-foreground">· {patientLabel}</span>}
          </DialogTitle>
          <KohPublishedResults clinicId={clinicId} customerId={visitor?.customer_id ?? null} />
          <p className="text-[11px] text-muted-foreground/70" data-testid="docs-hub-koh-note">
            ※ 균검사지 탭에서 입력·발행합니다.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HubButton({
  icon,
  title,
  desc,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex items-start gap-3 rounded-lg border border-input bg-background px-4 py-3.5 text-left transition hover:border-teal-400 hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-teal-500"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-foreground">{title}</span>
        {desc && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{desc}</span>}
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
