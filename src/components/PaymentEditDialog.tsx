/**
 * PaymentEditDialog — 수납 완료 건 수정 / 취소 / 삭제
 * T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
 *
 * 3 mode:
 *  edit   — 금액·수단·할인 수정 + audit INSERT
 *  cancel — 취소 사유 모달 → cancelled + audit INSERT
 *  delete — 삭제 사유 모달 → soft-delete + audit INSERT
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, XCircle, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { formatAmount, parseAmount } from '@/lib/format';

type PayMethod = 'card' | 'cash' | 'transfer';
export type EditMode = 'edit' | 'cancel' | 'delete';

export interface PaymentRowForEdit {
  id: string;
  amount: number;
  method: string;
  installment: number | null;
  payment_type: string;
  status?: string | null;
  check_in_id?: string | null;
  clinic_id?: string | null;
}

interface Props {
  payment: PaymentRowForEdit | null;
  mode: EditMode;
  onClose: () => void;
  onDone: () => void;
}

const METHOD_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'cash', label: '현금' },
  { value: 'transfer', label: '이체' },
];

const INSTALLMENT_OPTIONS = [
  { value: 0, label: '일시불' },
  { value: 2, label: '2개월' },
  { value: 3, label: '3개월' },
  { value: 6, label: '6개월' },
  { value: 10, label: '10개월' },
  { value: 12, label: '12개월' },
];

export function PaymentEditDialog({ payment, mode, onClose, onDone }: Props) {
  // Edit mode state
  const [amountStr, setAmountStr] = useState(payment ? String(payment.amount) : '');
  const [method, setMethod] = useState<PayMethod>((payment?.method as PayMethod) ?? 'card');
  const [installment, setInstallment] = useState(payment?.installment ?? 0);

  // Cancel / Delete mode state
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const [submitting, setSubmitting] = useState(false);

  if (!payment) return null;

  /* ── helpers ──────────────────────────────────────────────────── */

  const currentUser = async (): Promise<string> => {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email ?? data?.user?.id ?? 'unknown';
  };

  const insertAudit = async (opts: {
    action: 'edit' | 'cancel' | 'delete';
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    actor: string;
    reason?: string;
  }) => {
    await supabase.from('payment_audit_logs').insert({
      payment_id: payment.id,
      clinic_id: payment.clinic_id ?? null,
      check_in_id: payment.check_in_id ?? null,
      action: opts.action,
      before_data: opts.before,
      after_data: opts.after,
      actor: opts.actor,
      reason: opts.reason ?? null,
    });
  };

  /* ── submit handlers ──────────────────────────────────────────── */

  const handleEdit = async () => {
    const newAmount = parseAmount(amountStr);
    if (newAmount <= 0) {
      toast.error('금액을 입력하세요');
      return;
    }
    setSubmitting(true);
    try {
      const actor = await currentUser();

      const before = {
        amount: payment.amount,
        method: payment.method,
        installment: payment.installment,
      };
      const after = {
        amount: newAmount,
        method,
        installment: method === 'card' && installment > 0 ? installment : null,
      };

      const { error } = await supabase
        .from('payments')
        .update({
          amount: newAmount,
          method,
          installment: method === 'card' && installment > 0 ? installment : null,
        })
        .eq('id', payment.id);

      if (error) throw error;

      await insertAudit({ action: 'edit', before, after, actor });
      toast.success('수정 완료');
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`수정 실패: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!reason.trim()) {
      setReasonError('취소 사유를 입력하세요');
      return;
    }
    setSubmitting(true);
    try {
      const actor = await currentUser();

      const { error } = await supabase
        .from('payments')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: actor,
          cancel_reason: reason.trim(),
        })
        .eq('id', payment.id);

      if (error) throw error;

      await insertAudit({
        action: 'cancel',
        before: { status: payment.status ?? 'active' },
        after: { status: 'cancelled' },
        actor,
        reason: reason.trim(),
      });
      toast.success('취소 완료');
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`취소 실패: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!reason.trim()) {
      setReasonError('삭제 사유를 입력하세요');
      return;
    }
    setSubmitting(true);
    try {
      const actor = await currentUser();

      const { error } = await supabase
        .from('payments')
        .update({
          status: 'deleted',
          deleted_at: new Date().toISOString(),
          deleted_by: actor,
          delete_reason: reason.trim(),
        })
        .eq('id', payment.id);

      if (error) throw error;

      await insertAudit({
        action: 'delete',
        before: { status: payment.status ?? 'active' },
        after: { status: 'deleted' },
        actor,
        reason: reason.trim(),
      });
      toast.success('삭제 완료');
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`삭제 실패: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (mode === 'edit') return handleEdit();
    if (mode === 'cancel') return handleCancel();
    if (mode === 'delete') return handleDelete();
  };

  /* ── titles / styles ─────────────────────────────────────────── */

  const titles: Record<EditMode, string> = {
    edit: '수납 수정',
    cancel: '수납 취소',
    delete: '수납 삭제',
  };

  const submitLabels: Record<EditMode, string> = {
    edit: '저장',
    cancel: '취소 확인',
    delete: '삭제 확인',
  };

  const submitVariants: Record<EditMode, 'default' | 'destructive'> = {
    edit: 'default',
    cancel: 'destructive',
    delete: 'destructive',
  };

  const Icons: Record<EditMode, React.ReactNode> = {
    edit: <Pencil className="h-4 w-4" />,
    cancel: <XCircle className="h-4 w-4" />,
    delete: <Trash2 className="h-4 w-4" />,
  };

  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="payment-edit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {Icons[mode]}
            {titles[mode]}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 현재 수납 정보 (공통) */}
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">현재 금액</span>
              <span className="tabular-nums font-medium">{formatAmount(payment.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">결제 수단</span>
              <span>{payment.method}</span>
            </div>
          </div>

          {/* ── 수정 모드 ─────────────────────────────────────────── */}
          {mode === 'edit' && (
            <>
              <div className="space-y-2">
                <Label>결제 수단</Label>
                <div className="grid grid-cols-3 gap-2">
                  {METHOD_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      data-testid={`method-${m.value}`}
                      onClick={() => setMethod(m.value)}
                      className={cn(
                        'rounded-md border py-2 text-sm font-medium transition',
                        method === m.value
                          ? 'border-teal-600 bg-teal-50 text-teal-700'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>금액</Label>
                <Input
                  data-testid="input-amount"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="text-right tabular-nums text-lg"
                  autoFocus
                />
              </div>

              {method === 'card' && (
                <div className="space-y-2">
                  <Label>할부</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {INSTALLMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setInstallment(opt.value)}
                        className={cn(
                          'rounded border px-2 h-9 text-xs font-medium transition',
                          installment === opt.value
                            ? 'border-teal-600 bg-teal-50 text-teal-700'
                            : 'border-input hover:bg-muted',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── 취소 / 삭제 모드 — 사유 입력 ─────────────────────── */}
          {(mode === 'cancel' || mode === 'delete') && (
            <div className="space-y-2">
              <Label>
                {mode === 'cancel' ? '취소 사유' : '삭제 사유'}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Textarea
                data-testid="input-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim()) setReasonError('');
                }}
                placeholder={mode === 'cancel' ? '취소 사유를 입력하세요' : '삭제 사유를 입력하세요'}
                rows={3}
                className={cn('text-sm', reasonError && 'border-destructive')}
                autoFocus
              />
              {reasonError && (
                <p data-testid="reason-error" className="text-xs text-destructive">
                  {reasonError}
                </p>
              )}
              {mode === 'delete' && (
                <p className="text-xs text-muted-foreground">
                  삭제 후에도 이력에서 확인 가능합니다.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            닫기
          </Button>
          <Button
            data-testid="btn-submit"
            variant={submitVariants[mode]}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? '처리 중…' : submitLabels[mode]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 수납 이력 조회 컴포넌트 ─────────────────────────────────────── */

interface AuditLog {
  id: string;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor: string | null;
  reason: string | null;
  created_at: string;
}

interface PaymentAuditLogsPanelProps {
  paymentId: string;
}

export function PaymentAuditLogsPanel({ paymentId }: PaymentAuditLogsPanelProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from('payment_audit_logs')
      .select('id, action, before_data, after_data, actor, reason, created_at')
      .eq('payment_id', paymentId)
      .order('created_at', { ascending: false });
    setLogs((data ?? []) as AuditLog[]);
    setLoaded(true);
    setOpen(true);
  };

  const ACTION_KO: Record<string, string> = {
    create: '생성',
    edit: '수정',
    cancel: '취소',
    delete: '삭제',
  };

  const ACTION_COLOR: Record<string, string> = {
    create: 'text-teal-700',
    edit: 'text-blue-700',
    cancel: 'text-amber-700',
    delete: 'text-red-700',
  };

  if (!loaded) {
    return (
      <button
        type="button"
        data-testid="btn-show-audit"
        onClick={load}
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition"
      >
        수정·이력 보기
      </button>
    );
  }

  if (!open) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-md border bg-muted/50 px-3 py-2" data-testid="audit-log-panel">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">수납 이력</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          닫기
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">이력 없음</p>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="text-[11px] border-t pt-1.5 first:border-0 first:pt-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('font-semibold', ACTION_COLOR[log.action] ?? '')}>
                {ACTION_KO[log.action] ?? log.action}
              </span>
              <span className="text-muted-foreground">
                {new Date(log.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </span>
              {log.actor && (
                <span className="text-muted-foreground">— {log.actor}</span>
              )}
            </div>
            {log.action === 'edit' && log.before_data && log.after_data && (
              <div className="text-muted-foreground">
                금액: {String(log.before_data.amount ?? '')}→{String(log.after_data.amount ?? '')}
              </div>
            )}
            {log.reason && (
              <div className="text-muted-foreground">사유: {log.reason}</div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
