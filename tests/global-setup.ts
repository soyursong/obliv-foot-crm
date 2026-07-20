/**
 * Playwright globalSetup — run 시작 전 잔존 QA 픽스처 pre-sweep.
 *
 * 배경: 직전 run 이 hard-kill(머신 재부팅·SIGKILL 등)되면 globalTeardown 조차 못 돌아
 *   PROD 에 [QA-FIXTURE] row 가 남을 수 있다. 매 run 진입 시 한 번 청소해 누적을 끊는다.
 *   (teardown 이 1차 방어, setup 이 2차 보강 — 두 지점에서 잔존 0건 수렴)
 *
 * 또한 E2E 가 어느 Supabase 에 write 하는지 명시 로깅한다(prod 단일연결 가시성).
 */
import { cleanupAll, sweepScoped, ensureRunTokenFile, runToken, assertExpectedDbTarget } from './fixtures';

export default async function globalSetup() {
  const url = process.env.VITE_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[global-setup] Supabase env 미설정 → 픽스처 pre-sweep 건너뜀');
    return;
  }
  // run-scoped 시드 격리(T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN): 로컬(비-CI)에서
  //   워커 프로세스가 동일 run 토큰을 공유하도록 파일 기록. CI 는 GITHUB_RUN_ID 등에서 파생.
  ensureRunTokenFile();
  // PRODREF-HARDGUARD: 컷오버 후(EXPECT_DEV_DB_REF 주입 시) target 이 dev ref 가 아니면
  //   pre-sweep DELETE·픽스처 write 이전에 즉시 abort (secret 오배선→prod 오염 차단).
  assertExpectedDbTarget();
  console.log(`[global-setup] E2E 픽스처 write 대상 Supabase: ${url} (run-token=${runToken()})`);
  try {
    // 1) bare 마커 pre-sweep(기존) — legacy/비-scoped 잔재 회수. scoped row 는 매칭 안 함.
    const summary = await cleanupAll();
    const total = summary.customers + summary.checkIns + summary.packages + summary.reservations;
    if (total > 0) {
      console.log(
        `[global-setup] 직전 run 잔존 픽스처 pre-sweep — customers=${summary.customers} checkIns=${summary.checkIns} packages=${summary.packages} reservations=${summary.reservations}`,
      );
    }
    // 2) scoped stale pre-sweep — crash 로 leak 된 과거 run 의 scoped 시드만 TTL 로 회수한다.
    //    동시 실행 중인 다른 run 의 fresh scoped 시드는 TTL 미만이라 절대 삭제하지 않는다
    //    (cross-run cleanup race 원천 차단).
    const stale = await sweepScoped({ mode: 'stale' });
    const staleTotal = stale.customers + stale.checkIns + stale.packages + stale.reservations;
    if (staleTotal > 0) {
      console.log(
        `[global-setup] scoped stale pre-sweep(TTL 초과 leak) — customers=${stale.customers} checkIns=${stale.checkIns} packages=${stale.packages} reservations=${stale.reservations}`,
      );
    }
  } catch (e) {
    console.error('[global-setup] pre-sweep 실패(무시하고 진행):', e);
  }
}
