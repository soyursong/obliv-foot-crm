/**
 * T-20260514-foot-CHART2-OPEN-BUG (재오픈 수정)
 * 고객차트(2번차트) 오른쪽 슬라이드 패널
 *
 * AC-4: 모든 진입 경로(대시보드, 고객차트보기, URL 직접, 체크인 상세)에서 정상 열림
 *
 * v2 재구현 (2026-05-14):
 * - @base-ui/react Sheet 중첩 방식 제거
 *   → nested Dialog Portal-inside-Portal race condition으로 인터랙션 블로킹 발생
 * - ReactDOM.createPortal + CSS 슬라이드로 재구현
 *   → 외부 dialog context 완전 독립, 모든 진입 경로 안정적 동작
 * - ESC 키, 백드롭 클릭 닫기 지원
 * - zLevel=1 대응: z-[60](백드롭) / z-[70](패널)
 */
// T-20260516-foot-CHART2-STATE-UNIFY: MemoryRouter 제거 — RR6.30 nested Router 금지
// CustomerChartPage에 customerId prop 직접 주입으로 대체
import { useEffect, useRef, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { ChartSheetCloseCtx } from '@/lib/chartSheetContext';

const CustomerChartPage = lazy(() => import('@/pages/CustomerChartPage'));

interface Props {
  customerId: string | null;
  onClose: () => void;
}

export function CustomerChartSheet({ customerId, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC 키 핸들러
  useEffect(() => {
    if (!customerId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [customerId, onClose]);

  // 패널이 열릴 때 포커스 이동
  useEffect(() => {
    if (customerId && panelRef.current) {
      panelRef.current.focus();
    }
  }, [customerId]);

  if (!customerId) return null;

  return createPortal(
    <>
      {/* 백드롭 */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 슬라이드 패널 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="고객차트"
        className="fixed right-0 top-0 z-[70] h-full w-[95vw] sm:w-[88vw] max-w-5xl bg-background shadow-lg overflow-y-auto outline-none animate-in slide-in-from-right duration-300"
      >
        {/* X 닫기 버튼 */}
        <button
          className="sticky top-3 right-3 z-10 self-end rounded-md p-1 text-muted-foreground hover:bg-muted transition"
          onClick={onClose}
          aria-label="닫기"
          type="button"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <ChartSheetCloseCtx.Provider value={onClose}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                차트 불러오는 중…
              </div>
            }
          >
            {/* customerId prop 직접 주입 — useParams() 대신 prop 우선 사용 */}
            <CustomerChartPage customerId={customerId} />
          </Suspense>
        </ChartSheetCloseCtx.Provider>
      </div>
    </>,
    document.body,
  );
}
