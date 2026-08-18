/**
 * Refresh401Banner.tsx — refresh-401 비차단 상단 배너 (spec §3.1 (a))
 *
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step1 (a))
 *
 * 목표: 무한로딩·사일런트 저장실패(실보고 증상) 제거. 사용자에게 "서버 인증 일시지연·자동
 *   재시도 중, 입력은 보관됩니다" 정직 표시.
 *
 * 규약(spec §3.1):
 *   · **차단 모달 금지** — 현장 업무 정지 유발. 상단 고정 배너 + 진행 인디케이터(비차단).
 *   · 재시도 성공/인시던트 해소 시 자동 소멸(useRefresh401Ux.visible=false).
 *   · dedup: 이 배너는 "재시도 중" transient 신호만 담당. 최종 실패 시의 error toast(기존 경로)와
 *     역할이 겹치지 않는다(배너=진행중, 토스트=최종결과). 저장 성공 시 배너는 조용히 사라진다.
 *   · 재사용 경계: 로직(bus/hook)은 CRM 무관. 이 컴포넌트의 카피/테마(teal)만 per-CRM override.
 *
 * (c) 도입(Step2) 시 pendingWrites>0 이면 "저장 대기 N건" 을 함께 노출(유실0 가시성, spec §3.3 기준5).
 * 무패키지(div + tailwind). UpdateBanner 스타일 관례 준용(하단이 아닌 상단 — 업데이트 배너와 위치 분리).
 */
import { useRefresh401Ux } from '@/lib/resilience/useRefresh401Ux';

export default function Refresh401Banner() {
  const { visible, pendingWrites } = useRefresh401Ux();
  if (!visible) return null;

  const message =
    pendingWrites > 0
      ? `일시적 서버 지연 — 자동 재시도 중입니다. 저장 대기 ${pendingWrites}건은 보관 중이니 잠시만 기다려 주세요.`
      : '일시적 서버 지연 — 자동 재시도 중입니다. 입력하신 내용은 보관됩니다.';

  return (
    <div
      data-testid="refresh401-banner"
      data-pending={pendingWrites}
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[210] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 shadow-lg"
    >
      {/* 진행 인디케이터(비차단) — 순수 CSS 스피너, 무패키지 */}
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"
      />
      <span className="text-xs font-medium leading-snug sm:text-sm">{message}</span>
    </div>
  );
}
