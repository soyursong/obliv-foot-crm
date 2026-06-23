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

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setMemo('');
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
    try {
      const res = await createMut.mutateAsync({
        customerId,
        patientName,
        chartNo,
        birthDate,
        docType,
        selectedKeys: [...selected],
        staffMemo: memo.trim(),
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
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700" data-testid="opinion-req-pending-badge">
            처리 대기 {openForCustomer.length}건
          </span>
        )}
      </div>

      {/* 안내 — authoring 경계(AC-4): 선택=요청/참고, 발행=원장 */}
      <p className="mb-2 rounded bg-gray-50 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        원장님께 요청드릴 내용을 선택해 보내면, 원장님이 발행 시 참고합니다. <b>발행은 원장님만 가능</b>합니다.
      </p>

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
                docType === t.value ? 'bg-teal-600 text-white shadow-sm' : 'text-foreground hover:bg-accent'
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

      {/* AC-7: 해당항목 옵션 그리드(진단서/금기증) — 다중 토글 */}
      <div className="mb-2 max-h-[34vh] space-y-2 overflow-y-auto rounded-md border bg-muted/10 p-2" data-testid="opinion-req-options">
        {OPINION_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1 text-[10px] font-semibold text-muted-foreground">{section.title}</p>
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
              {section.options.map((opt) => {
                const active = selected.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggle(opt.key)}
                    aria-pressed={active}
                    title={opt.label}
                    data-testid={`opinion-req-opt-${opt.key}`}
                    className={`truncate rounded border px-1.5 py-1.5 text-[10px] font-medium transition ${
                      active
                        ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
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

      {/* 요청 메모(선택) */}
      <Textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="원장님께 전달할 메모(선택) — 예: 보험 제출용으로 필요합니다."
        className="mb-2 min-h-[3rem] text-[11px]"
        data-testid="opinion-req-memo"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground/80">
          {selected.size > 0 ? `선택 ${selected.size}개 · ${docTypeLabel(docType)}` : '항목을 선택하세요'}
        </span>
        <Button
          size="sm"
          className="h-8 gap-1 bg-teal-600 px-3 text-[11px] text-white hover:bg-teal-700 disabled:opacity-40"
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
            <div key={q.id} className="flex items-center gap-1.5 rounded bg-teal-50/50 px-2 py-1 text-[10px] text-teal-800">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="font-medium">{docTypeLabel(q.docType)}</span>
              <span className="text-teal-700/80">· 해당항목 {q.selectedKeys.length}개</span>
              {q.staffMemo && <span className="truncate text-teal-700/70" title={q.staffMemo}>· {q.staffMemo}</span>}
              <span className="ml-auto shrink-0 text-teal-600/70">원장 발행 대기</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
