// KohResultDialog — 균검사 결과지(검사결과 보고서) 미리보기 + 출력·복사·저장(PNG)
// Ticket: T-20260617-foot-KOHGEN-HTMLPORT (KOH-REPORT-TAB Phase2 unblock — 대표원장 자작 HTML 이식)
//
// ★ 별도 '균검사지 생성 페이지' 아님 — 旣 발행 동선(KohReportTab·KohPublishedResults)의 결과지
//   보기 surface 를 대체/확장하는 in-app 다이얼로그. 발행(publish_koh_result) 후 / 발행완료 행 인쇄 /
//   2번차트 검사결과 탭 '보기' 진입점이 모두 본 다이얼로그를 연다(단일 진입).
//
// 대표원장 웹앱 3버튼 동선 이식:
//   - 출력  : printKohResult(새 창 인쇄) — 기존 경로 재사용.
//   - 복사  : html2canvas → PNG → 클립보드(ClipboardItem). 실패 시 PNG 다운로드 폴백.
//   - 저장  : html2canvas → PNG 다운로드.
//
// 격리 설계: KOH_RESULT_HTML 은 #koh-report-sheet 스코프 + hex 색상(oklch 없음)이라
//   (a) 앱 DOM 주입 시 전역 스타일 오염 0, (b) html2canvas 1.4.1 의 Tailwind oklch 파싱 충돌 회피.

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Copy, Download, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { bindKohResultHtml, printKohResult, KOH_SHEET_ID } from '@/lib/printKohResult';

/** 다운로드 파일명 — 검사결과보고서_{수진자}_{의뢰번호|날짜}.png */
function buildFileName(fieldData: Record<string, unknown>): string {
  const name = String(fieldData['patient_name'] ?? '').trim() || 'report';
  const stamp =
    String(fieldData['request_no'] ?? '').trim() ||
    String(fieldData['collected_date'] ?? '').replace(/[.\-/]/g, '') ||
    new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `검사결과보고서_${name}_${stamp}.png`;
}

/** #koh-report-sheet element → html2canvas canvas. 동적 import 로 번들 분리. */
async function renderSheetCanvas(): Promise<HTMLCanvasElement> {
  const el = document.getElementById(KOH_SHEET_ID);
  if (!el) throw new Error('결과지 미리보기를 찾을 수 없습니다.');
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(el, {
    scale: Math.max(window.devicePixelRatio || 1, 2),
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
  });
}

export default function KohResultDialog({
  open,
  onOpenChange,
  fieldData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldData: Record<string, unknown> | null;
}) {
  const [busy, setBusy] = useState<null | 'copy' | 'save'>(null);

  // 바인딩된 결과지 HTML(스코프 <style> + #koh-report-sheet). field_data 없으면 빈 미리보기.
  const html = fieldData ? bindKohResultHtml(fieldData) : '';

  const handlePrint = () => {
    if (!fieldData) return;
    const ok = printKohResult(fieldData);
    if (!ok) toast.error('팝업이 차단되어 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
  };

  const handleCopy = async () => {
    if (!fieldData || busy) return;
    setBusy('copy');
    try {
      const canvas = await renderSheetCanvas();
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('이미지 변환 실패');
      // 클립보드 복사 — 비지원/거부 시 다운로드 폴백.
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        toast.success('결과지 이미지를 복사했습니다.');
      } catch {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = buildFileName(fieldData);
        a.click();
        toast.success('클립보드 복사가 지원되지 않아 이미지로 저장했습니다.');
      }
    } catch (e) {
      toast.error(`복사 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (!fieldData || busy) return;
    setBusy('save');
    try {
      const canvas = await renderSheetCanvas();
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = buildFileName(fieldData);
      a.click();
      toast.success('결과지 이미지를 저장했습니다.');
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[880px] w-[94vw]"
        data-testid="koh-result-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            검사결과 보고서
          </DialogTitle>
        </DialogHeader>

        {/* 액션 — 대표원장 3버튼(출력/복사/저장) */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={handlePrint}
            disabled={!fieldData}
            data-testid="koh-dialog-print"
          >
            <Printer className="h-4 w-4" /> 출력
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5 bg-teal-600 text-white hover:bg-teal-700"
            onClick={handleCopy}
            disabled={!fieldData || busy !== null}
            data-testid="koh-dialog-copy"
          >
            {busy === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} 복사
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5 bg-neutral-800 text-white hover:bg-neutral-900"
            onClick={handleSave}
            disabled={!fieldData || busy !== null}
            data-testid="koh-dialog-save"
          >
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} 저장
          </Button>
        </div>

        {/* 미리보기 — 794px sheet 를 스크롤 패널에 표시. #koh-report-sheet = html2canvas 캡처 타겟. */}
        <div
          className="mt-3 max-h-[68vh] overflow-auto rounded-lg border bg-neutral-100 p-3"
          data-testid="koh-dialog-preview"
        >
          {/* eslint-disable-next-line react/no-danger */}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
