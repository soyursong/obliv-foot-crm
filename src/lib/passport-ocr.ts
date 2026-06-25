// passport-ocr.ts — 여권 이미지 → MRZ 텍스트 OCR (클라이언트 사이드)
// T-20260625-foot-PASSPORT-FOREIGN-INFO-PORT (origin: T-20260609-derm-NEWCUST-PASSPORT-SCAN, 무변경 이식)
//
// PII 가드:
//  - tesseract.js를 dynamic import (lazy) → 메인 번들 미포함, 스캔 시점에만 로드.
//  - 이미지는 브라우저 메모리(ObjectURL/HTMLImageElement)에서만 처리 → 서버 업로드/저장 없음.
//  - OCR 종료 후 ObjectURL 즉시 revoke + worker terminate → 원본 이미지 잔존 폐기.
//  - 외부로 나가는 네트워크는 OCR 엔진 자산(wasm/traineddata, 오픈소스)뿐 — 여권 데이터 미반출.
//
// OCR 정확도 보강:
//  - MRZ charset(A-Z,0-9,<)으로 whitelist 제한 → 오인식 감소.
//  - 여권 하단 MRZ 영역 가독을 위해 long-edge 기준 다운스케일(과대 이미지 처리시간/메모리 절감).

import { parseMrz, type MrzResult } from '@/lib/mrz';

/** 처리 상태 콜백(스피너 진행 표시용). */
export type OcrProgress = (phase: string, progress: number) => void;

/** 이미지 파일 → HTMLCanvas (long-edge 다운스케일). 메모리 내 처리. */
async function fileToCanvas(file: File, maxEdge = 1600): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이미지를 불러올 수 없습니다'));
      el.src = url;
    });
    const longEdge = Math.max(img.width, img.height);
    const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 컨텍스트를 만들 수 없습니다');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    // 원본 ObjectURL 즉시 폐기 (PII 가드)
    URL.revokeObjectURL(url);
  }
}

/**
 * 여권 이미지 파일을 OCR → MRZ 파싱.
 * @returns 파싱 성공 시 MrzResult, 실패/인식불가 시 null (수동 입력 폴백)
 */
export async function scanPassportImage(
  file: File,
  onProgress?: OcrProgress,
): Promise<MrzResult | null> {
  // tesseract.js lazy load — 메인 번들 영향 없음
  const { createWorker } = await import('tesseract.js');
  onProgress?.('엔진 로딩', 0.1);

  const canvas = await fileToCanvas(file);
  onProgress?.('이미지 준비', 0.3);

  const worker = await createWorker('eng', 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.('인식 중', 0.3 + m.progress * 0.6);
      }
    },
  });
  try {
    // MRZ 허용 charset으로 제한 → 오인식 감소
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    });
    const { data } = await worker.recognize(canvas);
    onProgress?.('파싱', 0.95);
    const result = parseMrz(data.text ?? '');
    onProgress?.('완료', 1);
    return result;
  } finally {
    // worker terminate → OCR 컨텍스트/이미지 데이터 폐기 (PII 가드)
    await worker.terminate().catch(() => {});
    // canvas 픽셀 데이터 비우기
    canvas.width = 0;
    canvas.height = 0;
  }
}
