// DrugInfoTooltip — 약 정보 hover 툴팁(라운드 사각 박스)
// T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part D/E, AC-3/AC-4)
//
// 사용처(단일 컴포넌트 재사용 — AC-4 "컴포넌트 재사용"):
//   Part D) 진료차트 우측 '처방약 선택' 패널(DrugFolderTree) — 처방세트 약 hover
//   Part E) 진료차트 처방내역 테이블(MedicalChartPanel formRx) — 처방된 약 hover
//
// 데이터: '약 정보' = prescription_codes.description(Part C 입력) 중심 + 약 이름(보조).
//   설명 SSOT = description. 설명 없으면 깨지지 않게 약 이름만(미니멀) 표시(AC-5 엣지).
//
// 구현(신규 패키지 0):
//   QuickRxBar.QuickRxButton 의 hover 툴팁 패턴 동형 — createPortal + position:fixed
//   (overflow 스크롤 컨테이너/표 클리핑 회피). 마우스 떠나면 사라짐, pointer-events:none 으로
//   클릭/선택 동선 방해 X(AC-3). 우측 화면 이탈 클램프.

import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_W = 240;

interface DrugInfoTooltipProps {
  /** 약 이름(헤더) — 항상 표시. */
  name: string;
  /** 약 설명(prescription_codes.description). 없으면 미니멀(이름만) 표시. */
  description?: string | null;
  /** hover 대상 — 약 항목/이름 등. block/inline 어느 쪽이든 감싼다. */
  children: ReactNode;
  /** 래퍼 className(레이아웃 보존용). */
  className?: string;
  /** 테스트 식별자(Part D/E 구분). */
  testId?: string;
}

export default function DrugInfoTooltip({
  name,
  description,
  children,
  className,
  testId = 'drug-info-tooltip',
}: DrugInfoTooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - TOOLTIP_W - 8));
    setPos({ top: r.bottom + 6, left });
  }
  function hide() {
    setPos(null);
  }

  const hasDesc = !!description && description.trim() !== '';

  return (
    <>
      <span
        ref={ref}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        data-testid={`${testId}-anchor`}
      >
        {children}
      </span>

      {pos &&
        createPortal(
          <div
            role="tooltip"
            data-testid={testId}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: TOOLTIP_W, zIndex: 9999 }}
            className="pointer-events-none rounded-lg border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-lg"
          >
            <p className="text-[11px] font-semibold text-teal-700 break-words">{name}</p>
            {hasDesc ? (
              <p
                className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-foreground"
                data-testid={`${testId}-desc`}
              >
                {description}
              </p>
            ) : (
              <p className="mt-1 text-[10px] italic text-muted-foreground" data-testid={`${testId}-empty`}>
                등록된 설명 없음
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
