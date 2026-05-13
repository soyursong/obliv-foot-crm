/**
 * T-20260514-foot-CHART-EXPAND-UX
 * 고객차트(2번차트) 오른쪽 슬라이드 패널
 *
 * window.open() 팝업 대신 Sheet로 열림.
 * CustomerChartPage를 MemoryRouter로 감싸 useParams('/chart/:customerId') 공급.
 * AC-4: 기존 /chart/:customerId 직접 URL 접근은 App.tsx 라우팅을 그대로 유지.
 */
import { Suspense, lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Sheet, SheetContent } from '@/components/ui/sheet';

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
        className="w-[95vw] sm:w-[88vw] max-w-5xl p-0 overflow-y-auto"
      >
        {customerId && (
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
        )}
      </SheetContent>
    </Sheet>
  );
}
