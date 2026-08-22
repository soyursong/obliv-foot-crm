// T-20260822-foot-CLOSING-TXMEMO-SOFTPOPUP
//   회차 차감 버튼 클릭 시 당일 특이사항(치료메모)이 비어있으면 노출하는 **소프트 팝업(비강제)**.
//   문구: "특이사항이 없어요. 지금 입력할까요?"  버튼: [지금 쓸게요]/[입력하러 가기] · [나중에]
//
//   ★비강제 필수(AC3): [나중에] = 차감 그대로 완료(hard-block/강제저장 금지). onLater 는 항상
//   원래 consume 흐름을 그대로 재개한다. primary(입력 유도)는 차감 없이 입력 surface 로 유도.
//   태블릿 UX: 큰 버튼(h-12).
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface TxMemoSoftPopupProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** primary(입력 유도) 버튼 라벨. CustomerChartPage=[지금 쓸게요] / CheckInDetail·Packages=[입력하러 가기] */
  primaryLabel: string;
  /** primary 클릭 — 입력창 포커스(chart 내부) 또는 chart 이동. 차감 미실행. */
  onPrimary: () => void;
  /** [나중에] 클릭 — 차감 그대로 완료(비강제). */
  onLater: () => void;
}

export function TxMemoSoftPopup({
  open,
  onOpenChange,
  primaryLabel,
  onPrimary,
  onLater,
}: TxMemoSoftPopupProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>특이사항이 없어요</DialogTitle>
          <DialogDescription>지금 입력할까요?</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="h-12 flex-1 text-sm"
            data-testid="txmemo-softpopup-later"
            onClick={onLater}
          >
            나중에
          </Button>
          <Button
            className="h-12 flex-1 bg-teal-600 hover:bg-teal-700 text-sm"
            data-testid="txmemo-softpopup-primary"
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
