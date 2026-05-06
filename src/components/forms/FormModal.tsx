/**
 * FormModal — 태블릿 작성 양식 모달 래퍼
 *
 * T-20260506-foot-CHECKLIST-AUTOUPLOAD.
 *
 * 풋센터 표준 모달 외관을 양식 컴포넌트에 일괄 적용.
 * - 한국어 제목/설명
 * - teal-emerald 컬러 헤더
 * - 큰 푸터 버튼 (h-12, 태블릿 터치 UX)
 * - 스크롤 영역: max-h-[85vh]
 */
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** 저장 버튼 라벨 (기본: "저장") */
  submitLabel?: string;
  /** 저장 콜백 — async 가능 */
  onSubmit: () => Promise<void> | void;
  /** 저장 진행 중 여부 */
  submitting?: boolean;
  /** 저장 버튼 비활성 여부 (예: 동의 미체크) */
  submitDisabled?: boolean;
}

export function FormModal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  submitLabel = '저장',
  onSubmit,
  submitting = false,
  submitDisabled = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b pb-3 mb-2">
          <DialogTitle className="flex items-center gap-2 text-base text-teal-800">
            {icon}
            {title}
          </DialogTitle>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </DialogHeader>

        <div className="space-y-4 py-1">{children}</div>

        <DialogFooter className="gap-2 border-t pt-3 mt-2">
          <Button
            variant="outline"
            size="lg"
            className="h-12 px-6 text-sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button
            size="lg"
            className="h-12 px-6 text-sm bg-teal-600 hover:bg-teal-700"
            onClick={() => void onSubmit()}
            disabled={submitting || submitDisabled}
          >
            {submitting ? '저장 중…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
