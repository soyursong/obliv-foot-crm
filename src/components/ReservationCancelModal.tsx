/**
 * ReservationCancelModal — 예약 취소 사유 입력 모달
 * T-20260525-foot-RESV-CANCEL-CTX: 컨텍스트메뉴 예약 취소 경로
 *
 * AC-2: 취소사유 textarea (필수), 확인 버튼 사유 미입력 시 비활성화
 */
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  customerName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy?: boolean;
}

export function ReservationCancelModal({ open, customerName, onClose, onConfirm, busy = false }: Props) {
  const [reason, setReason] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 열릴 때마다 초기화 + 포커스
  useEffect(() => {
    if (open) {
      setReason('');
      // 다음 tick에 포커스 (Dialog 애니메이션 완료 후)
      setTimeout(() => taRef.current?.focus(), 80);
    }
  }, [open]);

  const canSubmit = reason.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="resv-cancel-modal">
        <DialogHeader>
          <DialogTitle className="text-red-600">예약 취소</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-gray-800">{customerName}</span> 님의 예약을 취소합니다.
          </p>
          {/* T-20260610-foot-RESV-MGMT-CTXMENU-DETAIL-5FIX item2: 취소=정보 keep·재예약 가능 의미 안내 (삭제와 구분) */}
          <p className="text-xs text-teal-700">
            취소해도 고객·예약 이력은 남으며, 같은 고객으로 다시 예약할 수 있습니다.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason" className="text-sm font-medium">
              취소 사유 <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="cancel-reason"
              ref={taRef}
              data-testid="cancel-reason-input"
              placeholder="취소 사유를 입력하세요"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            data-testid="cancel-modal-dismiss-btn"
          >
            닫기
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit || busy}
            data-testid="cancel-modal-confirm-btn"
          >
            {busy ? '취소 중…' : '예약 취소'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
