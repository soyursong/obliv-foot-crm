/**
 * T-20260610-foot-SPA-VERSION-AUTORELOAD
 *
 * 새 배포가 감지되면(useVersionCheck) 하단에 고정 배너를 띄운다.
 * 태블릿 UX: 큰 버튼 + 명확한 한국어 + teal-emerald 강조.
 *
 * AC-2 안전시점 제약: 자동 reload 하지 않는다. 사용자가 '새로고침' 을 직접 눌렀을
 *   때만 location.reload() → 진행 중 작업(문자 발송/차트 편집/폼 입력) 유실 방지.
 * AC-3: '새로고침' 클릭 → 전체 reload 로 신번들 적용.
 */
import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVersionCheck } from '@/hooks/useVersionCheck';

export default function UpdateBanner() {
  const { updateAvailable } = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      data-testid="app-update-banner"
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[200] flex flex-wrap items-center justify-center gap-3 border-t border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-[0_-2px_12px_rgba(0,0,0,0.08)]"
    >
      <span className="text-sm font-medium sm:text-base">
        새 버전이 있습니다. 새로고침하면 최신 화면으로 업데이트됩니다.
      </span>
      <Button
        size="lg"
        data-testid="app-update-reload"
        className="bg-emerald-600 text-white hover:bg-emerald-700"
        onClick={() => window.location.reload()}
      >
        <RefreshCw />
        새로고침
      </Button>
      <button
        type="button"
        aria-label="알림 닫기"
        className="absolute right-3 rounded-md p-1 text-emerald-700 hover:bg-emerald-100"
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
