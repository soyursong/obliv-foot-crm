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
import { cleanupAll, sweepScoped, runToken, assertExpectedDbTarget } from './fixtures';

export default async function globalTeardown() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[global-teardown] Supabase env 미설정 → 픽스처 스윕 건너뜀');
    return;
  }
  // PRODREF-HARDGUARD: 오배선된 prod target 에 teardown DELETE 를 쏘지 않도록 스윕 전 검문.
  assertExpectedDbTarget();
  try {
    // 1) bare 마커 스윕(기존) — scoped 시드는 매칭 안 함(다른 run 의 fresh 시드 불가침).
    const summary = await cleanupAll();
    console.log(
      `[global-teardown] QA 픽스처 스윕 완료 — customers=${summary.customers} checkIns=${summary.checkIns} packages=${summary.packages} reservations=${summary.reservations}`,
    );
    // 2) scoped 스윕(run-scoped 시드 격리, T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN):
    //    **이 run 토큰** 의 scoped 시드만 회수한다. 동시 실행 중인 다른 run 의 시드는 토큰이
    //    다르므로 절대 건드리지 않는다(cross-run cleanup race 원천 차단).
    const scoped = await sweepScoped({ mode: 'run' });
    console.log(
      `[global-teardown] scoped 스윕 완료(run-token=${runToken()}) — customers=${scoped.customers} checkIns=${scoped.checkIns} packages=${scoped.packages} reservations=${scoped.reservations}`,
    );
  } catch (e) {
    // teardown 실패가 run 결과를 가리지 않도록 throw 하지 않고 경고만.
    console.error('[global-teardown] 스윕 실패(잔존 가능) — 다음 run globalSetup 이 재스윕:', e);
  }
}
