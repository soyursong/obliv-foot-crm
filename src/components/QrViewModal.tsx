/**
 * QrViewModal — 임의 URL을 QR 코드 모달로 표시하는 공통 컴포넌트
 *
 * 최초 도입: T-20260603-foot-HEALTHQ-SELFLINK-QR-VIEW
 *   (발건강질문지 자가작성 섹션 — 발급된 health-q 링크 QR 응대)
 *
 * 공유 정책: T-20260603-foot-CHART2-QR-REOPEN(셀프접수 QR) 등 다른 QR 모달 니즈는
 *   이 컴포넌트를 재사용할 것. qrcode npm 2벌 도입 금지.
 *   QR 인코딩은 foot-native 패턴(api.qrserver.com 외부 이미지 API)을 사용 — 신규 npm 없음
 *   (SelfCheckIn.tsx / AdminSettings.tsx 동일 패턴).
 *
 * AC: 모달 X버튼/외부클릭 닫기(base-ui Dialog 기본) · QR 최소 200×200px.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface QrViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** QR 로 인코딩할 URL/문자열 */
  url: string;
  /** 모달 제목 (기본: 'QR 코드') */
  title?: string;
  /** QR 아래 보조 안내문 */
  caption?: string;
  /** QR 픽셀 크기 (기본 240, AC상 최소 200) */
  size?: number;
}

export function QrViewModal({
  open,
  onOpenChange,
  url,
  title = 'QR 코드',
  caption,
  size = 240,
}: QrViewModalProps) {
  // AC: 최소 200×200px 보장
  const px = Math.max(200, size);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&data=${encodeURIComponent(
    url,
  )}&qzone=2&margin=0&format=png`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="qr-view-modal">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 pb-1">
          <img
            src={qrSrc}
            alt="QR 코드"
            width={px}
            height={px}
            className="rounded-lg border bg-white"
            data-testid="qr-view-modal-image"
          />
          {caption && (
            <p className="text-xs text-muted-foreground text-center break-all px-2">{caption}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
