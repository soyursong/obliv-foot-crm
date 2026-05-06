/**
 * SignaturePad — Canvas API 기반 서명 패드
 *
 * T-20260506-foot-CHECKLIST-AUTOUPLOAD.
 *
 * - 새 npm 패키지 추가 없이 Canvas API + mouse/touch 이벤트 직접 처리.
 * - 태블릿 터치 UX: pointerEvent 사용으로 mouse/pen/touch 모두 지원.
 * - clear() / isEmpty() / toDataURL() 외부 ref 노출 (react-signature-canvas와 호환되는 인터페이스).
 *
 * 사용 예:
 *   const ref = useRef<SignaturePadHandle>(null);
 *   <SignaturePad ref={ref} width={420} height={150} />
 *   ref.current?.toDataURL('image/png');
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: (type?: string) => string;
}

interface Props {
  width?: number;
  height?: number;
  penColor?: string;
  className?: string;
  /** 외부에서 비었는지 여부 콜백 (실시간 업데이트) */
  onChange?: (isEmpty: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { width = 420, height = 150, penColor = '#1a1a1a', className, onChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 흰 배경 채우기 (PDF 임베드 시 투명도 문제 방지)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setEmpty(true);
      onChange?.(true);
    },
    isEmpty: () => empty,
    toDataURL: (type = 'image/png') => {
      const canvas = canvasRef.current;
      if (!canvas) return '';
      return canvas.toDataURL(type);
    },
  }));

  // 초기화: 흰 배경
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 고해상도 디스플레이 대응 (DPR 스케일링)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 2.2;
  }, [width, height, penColor]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pos = getPos(e);
    lastPosRef.current = pos;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 점 찍기 (탭 터치만 해도 점이 보이도록)
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = penColor;
    ctx.fill();
    if (empty) {
      setEmpty(false);
      onChange?.(false);
    }
  };

  const continueDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    const last = lastPosRef.current ?? pos;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const endDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPosRef.current = null;
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="서명 캔버스"
      className={className}
      style={{ touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={startDraw}
      onPointerMove={continueDraw}
      onPointerUp={endDraw}
      onPointerLeave={endDraw}
      onPointerCancel={endDraw}
    />
  );
});
