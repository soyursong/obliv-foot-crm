/**
 * T-20260611-foot-CONCURRENT-EDIT-LOCK — 양식 편집 잠금 안내 배너.
 *
 * 펜차트 양식 4종 편집 화면에서 다른 직원이 먼저 편집 중일 때(read-only) 상단에 고정 노출.
 * 태블릿 UX: 큰 글씨 + 명확한 한국어 + amber 경고 톤(잠금=주의, 저장 불가).
 *
 * 문구는 현장 확정값(buildLockMessage) 그대로:
 *   "지금 {편집자 이름}님이 편집 중이에요. 편집이 끝나면 알려드릴게요."
 */
import { Lock } from 'lucide-react';
import { buildLockMessage } from '@/lib/formEditLock';

interface FormEditLockBannerProps {
  /** 잠금 보유자(편집자) 이름. null 이면 '다른 직원' 폴백. */
  editorName: string | null;
}

export default function FormEditLockBanner({ editorName }: FormEditLockBannerProps) {
  return (
    <div
      data-testid="form-edit-lock-banner"
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <Lock className="size-5 shrink-0 text-amber-600" />
      <span className="text-sm font-medium sm:text-base">{buildLockMessage(editorName)}</span>
    </div>
  );
}
