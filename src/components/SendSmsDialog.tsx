/**
 * SendSmsDialog — 대시보드 고객 우클릭 [문자] → 템플릿 선택·간략수정 후 수동 1:1 발송
 * T-20260606-foot-CTXMENU-SMS-SEND
 *
 * 흐름:
 *  - 오픈 시 해당 지점(clinic_id) notification_templates 목록 로드 (메시지 설정 ③ 템플릿 관리 재사용)
 *  - 템플릿 선택 → 본문의 {고객명} 을 해당 고객 실제 성함으로 자동 치환 (§6 확정 2)
 *  - textarea 자유 편집 (이번 1회 발송만, 원본 템플릿 불변 — AC-3)
 *  - 상단에 고객 성함 + 전화번호 자동 표시 (오발송 방지 — §6 확정 2)
 *  - phone 없으면 발송 비활성 + "연락처 미등록" (AC-4)
 *  - 템플릿 0개면 안내 + 비활성 (AC-2)
 *  - "발송" → 확인 단계 1회(오발송 가드) → send-notification EF (_action:'manual_send', source:'manual_dashboard') 호출 (AC-5/AC-6c)
 *  - 결과 토스트 + messages 이력은 EF가 notification_logs 적재 (AC-7)
 *  - 발송 권한 = admin/manager (호출부 게이트, EF에서 재검증)
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, MessageSquare, Phone, User } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CheckIn } from '@/lib/types';

interface TemplateRow {
  id: string;
  event_type: string;
  channel: string;
  body: string;
  is_active: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkIn: CheckIn | null;
  clinicId: string;
}

/** 템플릿 표기명 — AdminSettings EVENT_TYPE_LABELS 와 동일 키 (없으면 event_type 그대로) */
const EVENT_LABELS: Record<string, string> = {
  resv_confirm: 'T01 예약 확정',
  resv_reminder_d1: 'T02 D-1 리마인드',
  resv_reminder_morning: 'T03 당일 아침',
  noshow: 'T04 노쇼 후속',
  manual_send: '수동 발송',
};

/** {고객명} 자동 치환 (§6 확정 2). 그 외 변수는 staff 가 직접 편집. */
function renderName(body: string, customerName: string): string {
  return body.replace(/\{고객명\}/g, customerName ?? '');
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

export default function SendSmsDialog({ open, onOpenChange, checkIn, clinicId }: Props) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const customerName = checkIn?.customer_name ?? '';
  const phone = checkIn?.customer_phone ?? null;
  const hasPhone = digitsOnly(phone).length > 0;

  // 오픈/고객 변경 시 상태 리셋 + 템플릿 로드
  useEffect(() => {
    if (!open || !clinicId) return;
    setSelectedId('');
    setBody('');
    setConfirmStep(false);
    setLoading(true);
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from('notification_templates') as any)
        .select('id, event_type, channel, body, is_active')
        .eq('clinic_id', clinicId)
        .order('event_type');
      if (cancelled) return;
      // 활성 템플릿 우선 노출 (비활성도 선택 가능하나 정렬상 뒤로)
      const rows = ((data as TemplateRow[]) ?? []).slice().sort(
        (a, b) => Number(b.is_active) - Number(a.is_active),
      );
      setTemplates(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clinicId, checkIn?.id]);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setConfirmStep(false);
      const tmpl = templates.find((t) => t.id === id);
      if (tmpl) setBody(renderName(tmpl.body, customerName));
    },
    [templates, customerName],
  );

  const byteLen = new TextEncoder().encode(body).length;
  const channelLabel = byteLen <= 90 ? 'SMS' : 'LMS';

  const canSend =
    hasPhone && body.trim().length > 0 && selectedId !== '' && !sending && templates.length > 0;

  const doSend = useCallback(async () => {
    if (!checkIn || !canSend) return;
    setSending(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('send-notification', {
        body: {
          _action: 'manual_send',
          clinic_id: clinicId,
          customer_id: checkIn.customer_id,
          recipient_phone: phone,
          body: body.trim(),
          source: 'manual_dashboard',
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (error) {
        toast.error(`문자 발송 실패: ${error.message}`);
        return;
      }
      const res = data as { success?: boolean; message?: string } | null;
      if (res?.success) {
        toast.confirm('문자 발송 완료');
        onOpenChange(false);
      } else {
        toast.error(res?.message ?? '문자 발송에 실패했습니다.');
        setConfirmStep(false);
      }
    } catch (e) {
      toast.error(`문자 발송 오류: ${String(e)}`);
    } finally {
      setSending(false);
    }
  }, [checkIn, canSend, clinicId, phone, body, onOpenChange]);

  if (!checkIn) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-teal-600" />
            문자 발송
          </DialogTitle>
          <DialogDescription>
            선택한 템플릿을 이번 발송에 한해 수정할 수 있습니다. (원본 템플릿은 변경되지 않습니다)
          </DialogDescription>
        </DialogHeader>

        {/* 대상 고객 — 성함 + 전화번호 자동 표시 (오발송 방지) */}
        <div
          data-testid="sms-recipient-box"
          className="rounded-lg border bg-teal-50/60 px-3 py-2.5 text-sm"
        >
          <div className="flex items-center gap-2 text-teal-800 font-semibold">
            <User className="h-4 w-4 shrink-0" />
            <span data-testid="sms-recipient-name">{customerName || '(이름 없음)'}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-gray-600">
            <Phone className="h-4 w-4 shrink-0" />
            {hasPhone ? (
              <span data-testid="sms-recipient-phone" className="font-mono">{phone}</span>
            ) : (
              <span data-testid="sms-recipient-nophone" className="text-red-600">연락처 미등록</span>
            )}
          </div>
        </div>

        {/* 템플릿 선택 */}
        {loading ? (
          <p className="text-sm text-gray-500 py-3">템플릿 불러오는 중…</p>
        ) : templates.length === 0 ? (
          <div
            data-testid="sms-no-template"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
          >
            등록된 템플릿이 없습니다 — 메시지 설정 → ③ 템플릿 관리에서 추가하세요.
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">템플릿 선택</label>
            <select
              data-testid="sms-template-select"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              value={selectedId}
              onChange={(e) => handleSelect(e.target.value)}
            >
              <option value="">— 템플릿을 선택하세요 —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {(EVENT_LABELS[t.event_type] ?? t.event_type)}
                  {t.is_active ? '' : ' (비활성)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 본문 미리보기 + 자유 편집 */}
        {selectedId !== '' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">본문 (자유 편집 가능)</label>
              <span className="text-[11px] text-gray-400">
                {byteLen}byte · {channelLabel}
              </span>
            </div>
            <Textarea
              data-testid="sms-body-textarea"
              value={body}
              onChange={(e) => { setBody(e.target.value); setConfirmStep(false); }}
              rows={5}
              className="resize-none text-sm"
            />
          </div>
        )}

        {/* 확인 단계 (오발송 가드) */}
        {confirmStep && (
          <div
            data-testid="sms-confirm-banner"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <b>{customerName}</b>({phone}) 님께 실제로 문자가 즉시 발송됩니다. 발송하시겠습니까?
            </span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            취소
          </Button>
          {!confirmStep ? (
            <Button
              data-testid="sms-send-btn"
              onClick={() => setConfirmStep(true)}
              disabled={!canSend}
              className="bg-teal-600 hover:bg-teal-700"
            >
              발송
            </Button>
          ) : (
            <Button
              data-testid="sms-send-confirm-btn"
              onClick={doSend}
              disabled={sending}
              className="bg-red-600 hover:bg-red-700"
            >
              {sending ? '발송 중…' : '확정 발송'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
