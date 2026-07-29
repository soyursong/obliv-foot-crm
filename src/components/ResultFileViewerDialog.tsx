// ResultFileViewerDialog — 검사결과지 파일(PDF·JPG·PNG) in-app 팝업(오버레이) 뷰어
// Ticket: T-20260728-foot-CHART2-LABRESULT-VIEW-OVERLAY-POPUP
//
// 배경: 2번 차트 [검사결과] 탭의 결과지 '보기'(Eye) 는 window.open(signedUrl, '_blank') 로
//   브라우저 새 탭을 열었다(태블릿 UX 부적합). 현장 요청 → 앱 내 별도 팝업(overlay/modal)으로 전환.
//
// 설계: documents 버킷 signedUrl(1h)을 받아 PDF=iframe / 이미지=img 로 렌더하는 순수 표시 레이어.
//   DB·데이터 연동 무변경(호출부가 signedUrl 을 만들어 넘긴다). 기존 ui/dialog(base-ui) 패턴 재사용.
//   닫기: 헤더 X · 배경(backdrop) 클릭 · Esc (base-ui 기본). 폴백: 새 창 열기 · 다운로드 링크 유지.

import { X, Download, ExternalLink, Loader2, FileText, Image as ImageIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** documents 버킷 on-demand signedUrl(1h). null=발급 중(로딩). */
  url: string | null;
  fileName: string;
  /** 이미지(jpg/png) 여부 — true=img, false=iframe(PDF 등). */
  isImage: boolean;
}

export default function ResultFileViewerDialog({ open, onOpenChange, url, fileName, isImage }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="flex h-[88vh] w-[92vw] max-w-4xl flex-col overflow-hidden p-0"
        data-testid="result-file-viewer"
      >
        {/* 헤더 바 — 파일명 + 새 창/다운로드 폴백 + 닫기 (태블릿 큰 터치 타깃) */}
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {isImage ? (
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-sm font-medium" title={fileName}>
              {fileName}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="새 창에서 열기"
                data-testid="result-file-viewer-newtab"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {url && (
              <a
                href={url}
                download={fileName}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="다운로드"
                data-testid="result-file-viewer-download"
              >
                <Download className="h-4 w-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="닫기"
              data-testid="result-file-viewer-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 본문 — PDF=iframe / 이미지=img. 잘림 없이 스크롤/contain. */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-800">
          {!url ? (
            <div className="flex flex-col items-center gap-2 text-neutral-300">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">결과지를 불러오는 중…</span>
            </div>
          ) : isImage ? (
            <img
              src={url}
              alt={fileName}
              className="max-h-full max-w-full object-contain"
              data-testid="result-file-viewer-image"
            />
          ) : (
            <iframe
              src={url}
              title={fileName}
              className="h-full w-full border-0 bg-white"
              data-testid="result-file-viewer-frame"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
