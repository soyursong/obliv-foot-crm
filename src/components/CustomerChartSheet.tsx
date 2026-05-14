/**
 * T-20260514-foot-CHART-EXPAND-UX
 * 고객차트(2번차트) 오른쪽 슬라이드 패널
 *
 * window.open() 팝업 대신 Sheet로 열림.
 * CustomerChartPage를 MemoryRouter로 감싸 useParams('/chart/:customerId') 공급.
 * AC-4: 기존 /chart/:customerId 직접 URL 접근은 App.tsx 라우팅을 그대로 유지.
 *
 * T-20260514-foot-CHART2-OPEN-BUG 수정:
 * - CustomerChartSheet를 CheckInDetailSheet SheetContent 안에 배치
 *   → @base-ui/react 중첩 다이얼로그 context 정상 연결
 * - zLevel={1} 로 z-[60]/z-[70] 적용 → 외부 Sheet z-50 위에 확실히 표시
 * - onClose prop을 CustomerChartPage에 전달 → 헤더 X버튼이 Sheet 닫기로 동작
 */
import { Suspense, lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ChartSheetCloseCtx } from '@/lib/chartSheetContext';

const CustomerChartPage = lazy(() => import('@/pages/CustomerChartPage'));

interface Props {
  customerId: string | null;
  onClose: () => void;
}

export function CustomerChartSheet({ customerId, onClose }: Props) {
  return (
    <Sheet open={!!customerId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        zLevel={1}
        className="w-[95vw] sm:w-[88vw] max-w-5xl p-0 overflow-y-auto"
      >
        {customerId && (
          <ChartSheetCloseCtx.Provider value={onClose}>
            <MemoryRouter initialEntries={[`/chart/${customerId}`]}>
              <Routes>
                <Route
                  path="/chart/:customerId"
                  element={
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                          차트 불러오는 중…
                        </div>
                      }
                    >
                      <CustomerChartPage />
                    </Suspense>
                  }
                />
              </Routes>
            </MemoryRouter>
          </ChartSheetCloseCtx.Provider>
        )}
      </SheetContent>
    </Sheet>
  );
}
