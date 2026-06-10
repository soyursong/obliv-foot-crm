/**
 * 양식/문서 이미지 업로드 다운스케일 가드
 *   T-20260609-foot-FORM-UPLOAD-DOWNSCALE-GUARD
 *
 * [왜 업로드 시점 가드인가 — origin: T-20260608-foot-PENCHART-REFUND-FORMIMG REOPEN#1]
 *   펜차트 배경/문서로 합성되는 양식 PNG 의 브라우저 decode heap 은 W×H×4(RGBA) 다.
 *   캔버스 물리상한 = CANVAS_W(794) × DRAW_DPR(2) = 1588px (= A4 192DPI).
 *   1588 초과분은 drawImage(0,0,CANVAS_W,canvasH) 가 어차피 버리므로 시각 이득 0이며,
 *   Galaxy Tab 에서 단일 decode heap 이 과대하면 img.decode() throw(E7) → 검정화면을 유발한다.
 *
 *   REOPEN#1 은 기존 6개 양식 PNG 를 폭 1588 로 재래스터화해 자산 레벨에서 E7 을 제거했다.
 *   그러나 admin 이 향후 고해상(2481px 등) 양식/문서 이미지를 *새로 업로드* 하면 동일 벡터가
 *   재발한다. 본 가드는 그 잔존 재투입 벡터를 업로드 시점에 구조적으로 차단한다.
 *     - 폭 > FORM_MAX_UPLOAD_WIDTH → 폭 1588 고정·비율 유지 재래스터(시각 손실 0)
 *     - 폭 ≤ 1588 → 원본 그대로 통과(무변환)
 *
 * 이 모듈은 양식/문서 이미지를 업로드하는 모든 admin 진입점의 단일 전처리 entry-point 다.
 * 신규 업로드 UI 추가 시 이 함수를 import 하여 동일 가드를 재사용한다(중복 구현 금지).
 */

/** 캔버스 물리상한 = CANVAS_W(794) × DRAW_DPR(2) = A4 192DPI. 양식 폭 상한. */
export const FORM_MAX_UPLOAD_WIDTH = 1588;

/**
 * AC-2 사용자 안내(무음 변환 금지). 다운스케일이 발생한 caller 가 *반드시 보이는* 토스트로
 * 노출한다(toast.confirm/warning — toast.info/success 는 묵음 처리되므로 사용 금지).
 */
export const FORM_DOWNSCALE_NOTICE =
  `고해상 이미지가 렌더 최적화를 위해 폭 ${FORM_MAX_UPLOAD_WIDTH}px로 자동 조정되었습니다.`;

export interface FormImageDownscaleResult {
  /** 저장에 사용할 파일 — 다운스케일 발생 시 신규 파일, 아니면 원본 그대로. */
  file: File;
  /** 다운스케일 발생 여부(= AC-2 안내 노출 조건). */
  downscaled: boolean;
  /** 원본 폭/높이(px). */
  originalWidth: number;
  originalHeight: number;
  /** 결과 폭/높이(px). */
  width: number;
  height: number;
}

/** image/png·image/jpeg 만 canvas 출력 타입으로 보존, 그 외는 png 로 표준화. */
function normalizeOutputType(srcType: string): 'image/png' | 'image/jpeg' {
  return srcType === 'image/jpeg' || srcType === 'image/jpg' ? 'image/jpeg' : 'image/png';
}

/** 출력 타입에 맞춰 파일명 확장자를 정정(.png/.jpg). */
function withExt(name: string, outType: 'image/png' | 'image/jpeg'): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${outType === 'image/jpeg' ? 'jpg' : 'png'}`;
}

/** File → HTMLImageElement 로드(naturalWidth/Height 측정용). 실패 시 reject. */
function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 디코드할 수 없습니다.'));
    };
    img.src = url;
  });
}

/**
 * 양식/문서 이미지 다운스케일 가드.
 *
 * @param file     업로드 대상 이미지 File
 * @param maxWidth 폭 상한(기본 FORM_MAX_UPLOAD_WIDTH=1588)
 * @returns        저장용 File + 다운스케일 발생 여부 + 치수 메타
 *
 * 폭 ≤ maxWidth 이면 원본을 그대로 반환(downscaled=false). 초과 시 폭 maxWidth 고정,
 * 비율 유지로 canvas 재래스터(imageSmoothingQuality='high')하여 신규 File 반환.
 * decode 실패 등 예외 시에는 원본을 그대로 통과시킨다(업로드 자체를 막지 않음 — 가드는
 * 메모리 최적화 목적이지 업로드 차단기가 아니다. 렌더 경로의 E7 폴백/타일 가드가 최종 방어선).
 */
export async function downscaleFormImage(
  file: File,
  maxWidth: number = FORM_MAX_UPLOAD_WIDTH,
): Promise<FormImageDownscaleResult> {
  let loaded: { img: HTMLImageElement; url: string } | null = null;
  try {
    loaded = await loadImage(file);
    const { img, url } = loaded;
    const ow = img.naturalWidth;
    const oh = img.naturalHeight;

    // 폭 상한 이하 → 무변환 통과(AC-3 비파괴 / 시나리오2).
    if (!ow || ow <= maxWidth) {
      URL.revokeObjectURL(url);
      return { file, downscaled: false, originalWidth: ow, originalHeight: oh, width: ow, height: oh };
    }

    // 폭 1588 고정·비율 유지 다운스케일(AC-1 / 시나리오1).
    const targetW = maxWidth;
    const targetH = Math.max(1, Math.round((oh * maxWidth) / ow));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return { file, downscaled: false, originalWidth: ow, originalHeight: oh, width: ow, height: oh };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);
    URL.revokeObjectURL(url);

    const outType = normalizeOutputType(file.type);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), outType, outType === 'image/jpeg' ? 0.92 : undefined),
    );
    if (!blob) {
      return { file, downscaled: false, originalWidth: ow, originalHeight: oh, width: ow, height: oh };
    }
    const outFile = new File([blob], withExt(file.name, outType), {
      type: outType,
      lastModified: Date.now(),
    });
    return {
      file: outFile,
      downscaled: true,
      originalWidth: ow,
      originalHeight: oh,
      width: targetW,
      height: targetH,
    };
  } catch {
    // 디코드/캔버스 예외 → 원본 통과(업로드 비차단).
    if (loaded) {
      try {
        URL.revokeObjectURL(loaded.url);
      } catch {
        /* noop */
      }
    }
    return {
      file,
      downscaled: false,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
    };
  }
}
