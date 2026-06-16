/**
 * Playwright globalTeardown — RC#0 PROD 픽스처 누적 차단의 구조적 안전망.
 *
 * 배경: E2E 가 dev=prod 단일 Supabase(rxlomoozakkjesdqjtvd)에 service_role 로 직접 write 한다.
 *   개별 spec 은 try/finally·afterAll 로 cleanup 하지만, 테스트가 timeout/crash/abort 로 죽으면
 *   그 hook 이 실행되지 않아 [QA-FIXTURE] row(특히 customers)가 PROD 에 잔존했다(RC#0).
 *
 * 이 teardown 은 전체 run 의 성공/실패와 무관하게 **항상 마지막에 1회** 실행되어
 *   cleanupAll() 로 모든 QA 픽스처 row 를 전수 스윕한다 → 잔존 0건 보장.
 *
 * 안전: cleanupAll 은 QA 마커/이름접두를 가진 row 만 삭제한다(실데이터 불가침).
 */
import { cleanupAll } from './fixtures';

export default async function globalTeardown() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[global-teardown] Supabase env 미설정 → 픽스처 스윕 건너뜀');
    return;
  }
  try {
    const summary = await cleanupAll();
    console.log(
      `[global-teardown] QA 픽스처 스윕 완료 — customers=${summary.customers} checkIns=${summary.checkIns} packages=${summary.packages} reservations=${summary.reservations}`,
    );
  } catch (e) {
    // teardown 실패가 run 결과를 가리지 않도록 throw 하지 않고 경고만.
    console.error('[global-teardown] cleanupAll 실패(잔존 가능) — 다음 run globalSetup 이 재스윕:', e);
  }
}
