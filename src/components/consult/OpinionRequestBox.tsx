// OpinionRequestBox — 상담내역 탭(실장영역) '원장님께 요청드릴 소견서/진단서 내용 선택' 인라인 박스.
// Ticket: T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK (AC-1/6/7/8)
//   진료 대시보드 소견서 작성 선택박스(서류종류 + 옵션 그리드)를 상담내역 구역에 인라인 직접 배치(AC-8, 팝업 제거).
//   실장이 서류종류(진단서/소견서, AC-6) + 해당항목(진단서/금기증 옵션, AC-7) + 메모를 골라 '발행 요청' →
//   진료 대시보드 서류작성 큐(원장영역)로 전달(AC-2/3).
//
// ★의료문서 authoring 경계(AC-4, BLOCKING): 실장은 '요청/참고'만. 소견서 본문 작성·확정·발행 = 원장 전용.
//   본 박스는 form_submissions status='draft'(요청 메타) 만 생성한다. 발행(published)·본문작성 UI 없음.

import { useMemo, useState } from 'react';
import { todaySeoulISODate } from '@/lib/format';
import { OPINION_SECTIONS } from '@/components/doctor/OpinionDocTab';
// T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (P1-1): 진단서 단일배타 / 금기증 복수 selection rule
//   — 원장 작성창(OpinionDocTab)과 동일 엔진 재사용(일관성).
import { buildContraindKeySet, classifySelection, applyPrefillExclusivity } from '@/lib/opinionDocCompose';
import {
  OPINION_DOC_TYPES,
  type OpinionDocType,
  useOpinionDocTemplateId,
  useCreateOpinionRequest,
  useOpinionRequestQueue,
  docTypeLabel,
} from '@/lib/opinionRequest';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FileText, Send } from 'lucide-react';

// T-20260630-foot-DIAGCERT-ORALMED-VIEWERBLUE-PDFBLACK (A안 AC6): '경구약 사유' 입력칸을 노출할
//   경구약 관련 옵션 key 집합. 경구약X(진단서)·효과미비·복용후 위장장애(금기증) — 항진균제 복용불가 사유 입력 대상.
//   (운영 DB 템플릿에서 `[…경구약 복용중]` 괄호가 어느 phrase에 있든, 원장 작성창 showOralXReason 이 최종 게이트.)
const ORAL_MED_REASON_KEYS = new Set(['oral_x', 'oral_ineffective', 'gi_after_oral']);

export default function OpinionRequestBox({
  customerId,
  clinicId,
  patientName,
  chartNo,
  birthDate,
  issuedBy,
  requestedByName,
}: {
  customerId: string;
  clinicId: string;
  patientName: string;
  chartNo: string | null;
  birthDate: string | null;
  issuedBy: string;              // 현재 직원 staff.id (form_submissions.issued_by, NOT NULL)
  requestedByName: string;       // 표기 스냅샷(요청 직원명)
}) {
  const [docType, setDocType] = useState<OpinionDocType>('opinion');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState('');
  // T-20260630-foot-DIAGCERT-ORALMED-VIEWERBLUE-PDFBLACK (A안 AC6): 경구약 사유 전용 입력칸.
  //   실장이 적은 사유 → form_submissions.field_data.oral_med_reason → 원장 작성창 oralXReason prefill(괄호 치환).
  const [oralMedReason, setOralMedReason] = useState('');
  // B-1 LOCK(MSG-r0uw): 서류 날짜 선택 — 기본값 당일(KST). 원장 작성창 `[날짜]` 치환 초기값으로 전달.
  const [requestDate, setRequestDate] = useState<string>(() => todaySeoulISODate());

  const { data: templateId = null } = useOpinionDocTemplateId(clinicId);
  const createMut = useCreateOpinionRequest(clinicId);
  const { data: queue = [] } = useOpinionRequestQueue(clinicId);

  // 이 고객의 처리 대기(open) 요청 — 중복요청 가시화.
  const openForCustomer = useMemo(
    () => queue.filter((q) => q.customerId === customerId),
    [queue, customerId],
  );

  // ── P1-1 selection rule ─────────────────────────────────────────────────────
  // 금기증 그룹 key 집합(복수선택 대상). 그 외(진단서 표준)는 단일배타.
  const contraindKeySet = useMemo(() => buildContraindKeySet(OPINION_SECTIONS), []);
  // 선택 그룹 분리(진단서 단일 / 금기증 복수) — 버튼 배타 disable 판정.
  const { diagnosisKeys: selDiagnosis, contraindKeys: selContraind } = useMemo(
    () => classifySelection([...selected], contraindKeySet),
    [selected, contraindKeySet],
  );
  const hasDiagnosis = selDiagnosis.length > 0;
  const hasContraind = selContraind.length > 0;

  // A안 AC6: '경구약 사유' 입력칸 노출 조건 — 경구약 관련 항목(경구약X·효과미비·복용후 위장장애)이 선택됐을 때만.
  //   ★뷰어 파란글씨/대괄호 치환은 원장 작성창의 DB 템플릿 phrase(`[…경구약 복용중]`)가 SSOT — 이 입력은
  //     원장 oralXReason prefill '소스'일 뿐. 미선택/미입력 시 기존 동작 유지(AC5).
  const showOralMedReason = useMemo(
    () => [...selected].some((k) => ORAL_MED_REASON_KEYS.has(k)),
    [selected],
  );

  // T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (P1-1): 진단서(표준)=단일배타 / 금기증=복수선택.
  //   {진단서 1개 단독} XOR {금기증 N개} — 두 그룹 동시선택 불가(원장 작성창 OpinionDocTab 과 동일 rule).
  //   - 금기증 클릭 → 토글(복수).
  //   - 진단서 클릭 → 이미 선택이면 해제, 아니면 그 1개만(다른 선택 전부 해제 = 단일배타).
  const handleOptionClick = (key: string) => {
    const isContraind = contraindKeySet.has(key);
    setSelected((prev) => {
      const next = new Set(prev);
      if (isContraind) {
        if (next.has(key)) next.delete(key);
        else next.add(key);
      } else {
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.clear();
          next.add(key);
        }
      }
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setMemo('');
    setOralMedReason('');
    setDocType('opinion');
    setRequestDate(todaySeoulISODate());
  };

  const handleRequest = async () => {
    if (!issuedBy) {
      toast.error('직원 계정 정보를 확인할 수 없어 요청할 수 없습니다. 다시 로그인 후 시도해주세요.');
      return;
    }
    if (selected.size === 0) {
      toast.error('요청할 항목을 1개 이상 선택해주세요.');
      return;
    }
    // T-20260629-foot-DOCREQ-DIAGCERT-CONTRA-MUTEX (§3 제출 시점 가드): 선택 UI(handleOptionClick+disabled)가
    //   이미 배타를 유지하므로 정상 흐름에선 무변경(no-op)이나, 어떤 경로로든 진단서+금기증 혼합이 state 에 섞이면
    //   persist 직전 배타 규칙을 재적용해 '깨진 조합'이 큐 draft 로 저장되는 일을 원천 차단(향후 prefill/목록 오염 방지).
    const cleanKeys = applyPrefillExclusivity([...selected], contraindKeySet, docType);
    try {
      const res = await createMut.mutateAsync({
        customerId,
        patientName,
        chartNo,
        birthDate,
        docType,
        selectedKeys: cleanKeys,
        staffMemo: memo.trim(),
        // A안 AC6: 경구약 관련 항목이 선택됐을 때만 사유 전달(아니면 빈값=기존 동작 AC5).
        oralMedReason: showOralMedReason ? oralMedReason.trim() : '',
        issuedBy,
        requestedByName,
        templateId,
        requestDate,
      });
      if (res.hasCheckIn) {
        toast.success(`${docTypeLabel(docType)} 발행 요청을 원장님께 보냈습니다.`);
      } else {
        // 내방(check_in) 이력이 없으면 원장이 발행 앵커를 못 잡음 — 요청은 전달되나 안내.
        toast.success(`${docTypeLabel(docType)} 요청을 보냈습니다. (내원 이력이 없어 원장님 발행 전 내원 확인이 필요할 수 있어요)`);
      }
      reset();
    } catch (e) {
      toast.error(`요청 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-3 text-xs" data-testid="consult-section-opinion">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          소견서 &amp; 진단서 요청
        </div>
        {openForCustomer.length > 0 && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600" data-testid="opinion-req-pending-badge">
            처리 대기 {openForCustomer.length}건
          </span>
        )}
      </div>

      {/* AC-6: 서류종류 2종 (소견서 / 진단서) */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">서류종류</span>
        <div className="inline-flex rounded-md border p-0.5" role="group" data-testid="opinion-req-doctype">
          {OPINION_DOC_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDocType(t.value)}
              aria-pressed={docType === t.value}
              data-testid={`opinion-req-doctype-${t.value}`}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                docType === t.value ? 'bg-neutral-800 text-white shadow-sm' : 'text-foreground hover:bg-accent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* B-1 LOCK(MSG-r0uw): 서류 날짜 — 기본값 당일(KST). 원장 작성창 `[날짜]` 치환 초기값으로 전달. */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">서류 날짜</span>
        <input
          type="date"
          value={requestDate}
          onChange={(e) => setRequestDate(e.target.value)}
          data-testid="opinion-req-date"
          className="rounded-md border px-2 py-1 text-[11px] text-foreground"
        />
      </div>

      {/* AC-7: 해당항목 옵션 그리드(진단서/금기증) — P1-1: 진단서 단일배타 XOR 금기증 복수선택 */}
      <div className="mb-2 max-h-[34vh] space-y-2 overflow-y-auto rounded-md border bg-muted/10 p-2" data-testid="opinion-req-options">
        {OPINION_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1 text-[10px] font-semibold text-muted-foreground">{section.title}</p>
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
              {section.options.map((opt) => {
                const active = selected.has(opt.key);
                const isContraindOpt = contraindKeySet.has(opt.key);
                // P1-1 단일배타: 진단서 선택 시 그 1개 외 전부 비활성 / 금기증 선택 시 진단서 비활성.
                const disabled = hasDiagnosis
                  ? !active
                  : hasContraind
                    ? !isContraindOpt
                    : false;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleOptionClick(opt.key)}
                    disabled={disabled}
                    aria-pressed={active}
                    title={
                      disabled
                        ? hasDiagnosis
                          ? '진단서(표준)는 단일선택입니다. 선택을 해제한 뒤 다른 항목을 고르세요.'
                          : '금기증을 선택 중입니다. 진단서(표준)는 함께 선택할 수 없습니다.'
                        : opt.label
                    }
                    data-testid={`opinion-req-opt-${opt.key}`}
                    className={`truncate rounded border px-1.5 py-1.5 text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? 'border-neutral-800 bg-neutral-800 text-white shadow-sm'
                        : 'border-input bg-background text-foreground hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* A안 AC6: 경구약 사유 전용 입력칸 — 경구약 관련 항목 선택 시 노출. 원장 진단서 작성창 경구약 항목에 자동 반영. */}
      {showOralMedReason && (
        <div className="mb-2 space-y-1 rounded-md border border-blue-200 bg-blue-50/50 p-2" data-testid="opinion-req-oralmed">
          <label className="block text-[10px] font-semibold text-blue-800" htmlFor="opinion-req-oralmed-input">
            경구약 사유 <span className="font-normal text-blue-600/80">(예: 고혈압, 당뇨, 고지혈증으로 인한 경구약 복용중)</span>
          </label>
          <Textarea
            id="opinion-req-oralmed-input"
            value={oralMedReason}
            onChange={(e) => setOralMedReason(e.target.value)}
            placeholder="경구약 복용 사유"
            className="min-h-[2.5rem] border-blue-200 bg-white text-[11px]"
            data-testid="opinion-req-oralmed-input"
          />
        </div>
      )}

      {/* 요청 메모(선택) */}
      <Textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="원장님께 전달할 메모(선택)"
        className="mb-2 min-h-[3rem] text-[11px]"
        data-testid="opinion-req-memo"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground/80">
          {selected.size > 0 ? `선택 ${selected.size}개 · ${docTypeLabel(docType)}` : '항목을 선택하세요'}
        </span>
        <Button
          size="sm"
          className="h-8 gap-1 bg-neutral-800 px-3 text-[11px] text-white hover:bg-neutral-900 disabled:opacity-40"
          disabled={createMut.isPending || selected.size === 0 || !issuedBy}
          onClick={handleRequest}
          data-testid="opinion-req-submit"
        >
          {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {createMut.isPending ? '전송 중…' : '발행 요청'}
        </Button>
      </div>

      {/* 처리 대기 요청 목록(이 고객) — 실장이 보낸 요청 가시화 */}
      {openForCustomer.length > 0 && (
        <div className="mt-2 space-y-1 border-t pt-2" data-testid="opinion-req-pending-list">
          {openForCustomer.map((q) => (
            <div key={q.id} className="flex items-center gap-1.5 rounded bg-neutral-100/60 px-2 py-1 text-[10px] text-neutral-700">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="font-medium">{docTypeLabel(q.docType)}</span>
              <span className="text-neutral-500">· 해당항목 {q.selectedKeys.length}개</span>
              {q.staffMemo && <span className="truncate text-neutral-500" title={q.staffMemo}>· {q.staffMemo}</span>}
              <span className="ml-auto shrink-0 text-neutral-500">원장 발행 대기</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
