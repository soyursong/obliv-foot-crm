// ColumnExpandPopover — 컬럼-앵커 드롭다운/팝오버(미리보기 셀 클릭 → 전문 펼침).
//
// 출처: T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (DoctorCallDashboard 처방/임상경과 셀).
//   설계: 클릭한 '해당 컬럼 폭 범위 안에서만' 셀 바로 아래로 드롭다운처럼 열림 → 가로로 다른 컬럼 비가림(0 침범).
//   전문이 길면 컬럼 폭 안에서 줄바꿈(break-words) + 세로 스크롤(max-h + overflow-y-auto).
//   좌표·바깥클릭 닫힘(mousedown)·Esc·up/down clamp = CHART-CLINICAL-CLICKOUTSIDE 패턴.
//
// T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: 진료대시보드 '서류작성' 큐(DocRequestQueue) 처방내역·임상경과
//   칼럼이 동일 '미리보기+드롭다운' 표현을 상속하도록 DoctorCallDashboard 로컬 정의를 본 공유 모듈로 추출(중복 재구현 금지).
//   동작 무변경 — DoctorCallDashboard는 본 export 를 import 만 한다(회귀 0).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ColumnExpandPopover({
  open,
  anchorRef,
  onClose,
  children,
  testId,
  widthScale = 1,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
  /**
   * T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item2(문지은 대표원장): 처방 드롭다운만 폭 ×2(가독성).
   *   policy_superseded: f8ad7a9 '비가림(폭=앵커 컬럼폭)' 설계를 rx 드롭다운 한정 역전(reporter-explicit 예외).
   *   left clamp 로 우측 화면 이탈만 방지(다른 드롭다운=임상경과는 widthScale=1 유지, 무회귀).
   */
  widthScale?: number;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; placement: 'down' | 'up' } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function compute() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 폭 = 앵커 셀(컬럼) 폭 × widthScale — 기본 1(비가림). item2: rx 드롭다운만 ×2(가독성). 셀 좌측 정렬, 우측 이탈 clamp.
      const width = Math.min(r.width * widthScale, vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      // 세로: 아래 공간 부족 + 위 공간 더 넓으면 위쪽으로(하단 행 잘림 방지) — RxPopover 선례 동일.
      const estH = popRef.current?.offsetHeight ?? 160;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      let placement: 'down' | 'up' = 'down';
      let top = r.bottom + 4;
      if (spaceBelow < estH + 12 && spaceAbove > spaceBelow) {
        placement = 'up';
        top = Math.max(8, r.top - estH - 4);
      }
      setPos({ top, left, width, placement });
    }
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open, anchorRef, widthScale]);

  // 바깥 클릭 + Esc 닫기(앵커 셀 클릭은 본문 토글이 처리하므로 제외) — CHART-CLINICAL-CLICKOUTSIDE mousedown 패턴.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={popRef}
      data-testid={testId}
      data-placement={pos.placement}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="max-h-[60vh] overflow-y-auto rounded-lg border bg-white shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

export default ColumnExpandPopover;
