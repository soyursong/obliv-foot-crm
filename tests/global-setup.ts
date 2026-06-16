/**
 * Playwright globalSetup — run 시작 전 잔존 QA 픽스처 pre-sweep.
 *
 * 배경: 직전 run 이 hard-kill(머신 재부팅·SIGKILL 등)되면 globalTeardown 조차 못 돌아
 *   PROD 에 [QA-FIXTURE] row 가 남을 수 있다. 매 run 진입 시 한 번 청소해 누적을 끊는다.
 *   (teardown 이 1차 방어, setup 이 2차 보강 — 두 지점에서 잔존 0건 수렴)
 *
 * 또한 E2E 가 어느 Supabase 에 write 하는지 명시 로깅한다(prod 단일연결 가시성).
 */
import { cleanupAll } from './fixtures';

export default async function globalSetup() {
  const url = process.env.VITE_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[global-setup] Supabase env 미설정 → 픽스처 pre-sweep 건너뜀');
    return;
  }
  console.log(`[global-setup] E2E 픽스처 write 대상 Supabase: ${url}`);
  try {
    const summary = await cleanupAll();
    const total = summary.customers + summary.checkIns + summary.packages + summary.reservations;
    if (total > 0) {
      console.log(
        `[global-setup] 직전 run 잔존 픽스처 pre-sweep — customers=${summary.customers} checkIns=${summary.checkIns} packages=${summary.packages} reservations=${summary.reservations}`,
      );
    }
  } catch (e) {
    console.error('[global-setup] pre-sweep 실패(무시하고 진행):', e);
  }
}
