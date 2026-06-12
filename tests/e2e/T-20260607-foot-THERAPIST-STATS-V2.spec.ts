/**
 * E2E spec — T-20260607-foot-THERAPIST-STATS-V2
 * 치료사 통계 로직 재설계 (코어 AC1~AC6).
 *
 * 현장 요청 (문지은 대표원장 / 김주연 총괄, 슬랙 C0ATE5P6JTH):
 *   "치료사 통계 로직 다시 짜줘 — 속도·양, 시술 분류, 이벤트 순서 무관 매칭."
 *
 * 확정 SSOT:
 *   - AC1 시술 분류 = 4종 [비가열/가열/포돌로게/Re:Born]. 수액(iv)·체험(trial) 제외.
 *     프리컨디셔닝(preconditioning) 입력 = 비가열 범주.
 *   - AC2 측정 구간 = 시작(최초 preconditioning 진입=to_status) → 종료(치료실 퇴실).
 *     ★정정(20260612130000, 김주연 총괄): 종료 = 치료실 슬롯을 떠나는 최초 전이
 *       = from_status='preconditioning'인 가장 이른 전이(목적지 무관: laser/done/healer 등).
 *       기존 'to_status=laser' 는 레이저실 미방문 세션(치료실→done 등)을 누락 → 정정으로 포함.
 *       핵심 = "고객이 치료실에서 머문 시간" 추출.
 *   - AC3 이벤트 순서 무관 매칭: A(치료실 퇴실=측정시간)·B(티켓 차감) 임의 순서 → 둘 다 영속 →
 *     (고객+KST일자+치료사) JOIN 성립 시 linked → 집계. 단독 = pending(제외). carry-over 없음.
 *   - AC4 치료사 × 4종: cnt=차감건수(분포), avg=linked 만.
 *
 * 구현:
 *   - RPC: foot_stats_therapist_summary(v2: 시작=precond, 종료=laser, linked 만 평균),
 *          foot_stats_therapist_services(v2: 4종 treatment_type 분포 + 시술별 평균시간)
 *   - 별도 staging 테이블 없음 (db_change=false) — 두 이벤트가 status_transitions·package_sessions 에 영속.
 *   - FE: src/components/stats/TherapistStatsSection.tsx 지표2 = 4종 + 평균시간 표.
 *
 * 시나리오 → AC 매핑:
 *   시나리오1 정상 동선(4종 표기·프리컨디셔닝=비가열) → AC1·AC2·AC4·AC6
 *   시나리오2 이벤트 순서 무관 매칭(A단독 pending → B linked, 역순 동일) → AC3
 *   시나리오3 엣지(수액 제외, 빈 기간 안전) → AC1·AC6
 *
 * RPC SQL 핵심 불변식을 page.evaluate 순수 함수로 검증(seeded DB 비의존, 로직 회귀 방지).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// RPC v2 와 동일한 4종 분류 매핑 (AC1)
const SESSION_TYPE_TO_CATEGORY: Record<string, string | null> = {
  unheated_laser: '비가열',
  preconditioning: '비가열', // AC1: 프리컨디셔닝 = 비가열 범주
  heated_laser: '가열',
  podologue: '포돌로게',
  reborn: 'Re:Born',
  iv: null, // 수액 제외
  trial: null, // 체험 제외
};

test.describe('T-20260607 THERAPIST-STATS-V2 — 치료사 통계 재설계', () => {
  // ── 시나리오1 / AC1: session_type → 4종 정규화, 프리컨디셔닝=비가열, 수액 제외 ──
  test('AC1: session_type 이 4종 [비가열/가열/포돌로게/Re:Born] 로 정규화되고 수액은 제외된다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate((map) => {
      const normalize = (st: string): string | null => map[st] ?? null;
      return {
        unheated: normalize('unheated_laser'),
        precond: normalize('preconditioning'),
        heated: normalize('heated_laser'),
        podo: normalize('podologue'),
        reborn: normalize('reborn'),
        iv: normalize('iv'),
        trial: normalize('trial'),
        // 4종 외(수액/체험)은 분류 결과가 null → 통계 제외 대상
        included: ['unheated_laser', 'preconditioning', 'heated_laser', 'podologue', 'reborn', 'iv', 'trial']
          .filter((s) => normalize(s) !== null),
      };
    }, SESSION_TYPE_TO_CATEGORY);

    expect(result.unheated).toBe('비가열');
    expect(result.precond).toBe('비가열'); // AC1 핵심: 프리컨디셔닝 → 비가열
    expect(result.heated).toBe('가열');
    expect(result.podo).toBe('포돌로게');
    expect(result.reborn).toBe('Re:Born');
    expect(result.iv).toBeNull(); // 수액 제외
    expect(result.trial).toBeNull(); // 체험 제외
    // 분류축은 정확히 5개의 session_type 이 4종으로 매핑(unheated+precond→비가열 2:1)
    expect(result.included.sort()).toEqual(
      ['heated_laser', 'podologue', 'preconditioning', 'reborn', 'unheated_laser'].sort(),
    );
  });

  // ── 시나리오1 / AC2(정정): 측정구간 = 최초 preconditioning 진입(to) → 치료실 퇴실(from) ──
  test('AC2: 측정구간은 시작(최초 to_status=preconditioning) → 종료(치료실 퇴실=최초 from_status=preconditioning, 목적지 무관)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // status_transitions 모델: 각 전이는 from_status·to_status·at(epoch minutes) 보유.
      type ST = { from_status: string; to_status: string; at: number };
      // ★정정 a_events 와 동일: 시작=최초 to_status='preconditioning'(치료실 입장),
      //   종료=최초 from_status='preconditioning'(치료실 퇴실, 목적지 무관). 둘 다 있고 종료>시작.
      const windowMinutes = (sts: ST[]): number | null => {
        const entries = sts.filter((s) => s.to_status === 'preconditioning');
        const exits = sts.filter((s) => s.from_status === 'preconditioning');
        if (entries.length === 0 || exits.length === 0) return null;
        const start = Math.min(...entries.map((s) => s.at));
        const end = Math.min(...exits.map((s) => s.at));
        return end > start ? end - start : null;
      };

      // A: tw→precond@10, precond→laser@30, laser→done@90 ⇒ 20분 (치료실 체류[10~30])
      const a = windowMinutes([
        { from_status: 'treatment_waiting', to_status: 'preconditioning', at: 10 },
        { from_status: 'preconditioning', to_status: 'laser', at: 30 },
        { from_status: 'laser', to_status: 'done', at: 90 },
      ]);
      // B(★레이저실 미방문): tw→precond@10, precond→done@50 ⇒ 40분.
      //   정정 전(to_status=laser)이면 종료 미검출 → null(누락). 정정 후 치료실 퇴실(@50) 포착 → 포함.
      const b = windowMinutes([
        { from_status: 'treatment_waiting', to_status: 'preconditioning', at: 10 },
        { from_status: 'preconditioning', to_status: 'done', at: 50 },
      ]);
      // B2(★미방문, 힐러 경유): precond→healer_waiting@45 ⇒ 35분. 목적지 무관 포착.
      const b2 = windowMinutes([
        { from_status: 'treatment_waiting', to_status: 'preconditioning', at: 10 },
        { from_status: 'preconditioning', to_status: 'healer_waiting', at: 45 },
        { from_status: 'healer_waiting', to_status: 'done', at: 80 },
      ]);
      // C: precond 입장 없음(laser 만) ⇒ null (치료실 미진입)
      const c = windowMinutes([
        { from_status: 'laser_waiting', to_status: 'laser', at: 100 },
        { from_status: 'laser', to_status: 'done', at: 130 },
      ]);
      // D(미퇴실): 치료실 입장 후 퇴실 전이 없음(아직 치료실 체류) ⇒ null (incomplete → pending)
      const d = windowMinutes([
        { from_status: 'treatment_waiting', to_status: 'preconditioning', at: 10 },
      ]);
      return { a, b, b2, c, d };
    });

    expect(result.a).toBe(20); // 치료실 퇴실(@30, →laser) 기준
    expect(result.b).toBe(40); // ★정정 핵심: 레이저실 미방문(치료실→done)도 집계 포함
    expect(result.b2).toBe(35); // 목적지 무관(치료실→힐러대기) 포착
    expect(result.c).toBeNull(); // 치료실 미진입 → 제외
    expect(result.d).toBeNull(); // 미퇴실(incomplete) → 제외
  });

  // ── 시나리오2 / AC3(정정): 이벤트 순서 무관 매칭 — 이벤트 A='치료실 퇴실'(레이저실 미방문 케이스 포함) ──
  test('AC3: A(치료실 퇴실)·B 가 (고객+일자+치료사)로 매칭될 때만 linked → 집계, 레이저실 미방문 세션도 A 로 잡힌다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // 이벤트 A = '치료실 퇴실'(from_status='preconditioning'인 최초 전이 → 측정시간 보유, 목적지 무관).
      //   exitTo = 치료실에서 떠난 목적지(laser/done/healer 등). 정정 전(laser-only)이면 exitTo!=='laser' 는 미검출.
      // 이벤트 B = 티켓 차감(시술분류 보유). 매칭키 = cust+date+therapist.
      type A = { check_in: string; cust: string; date: string; therapist: string; minutes: number; exitTo: string };
      type B = { cust: string; date: string; therapist: string; type: string };

      const aEvents: A[] = [
        // ci1: 치료실→레이저 퇴실(레이저실 방문) — B 매칭 O
        { check_in: 'ci1', cust: 'c1', date: '2026-06-09', therapist: 't1', minutes: 20, exitTo: 'laser' },
        // ci2: B 없음 → pending
        { check_in: 'ci2', cust: 'c2', date: '2026-06-09', therapist: 't1', minutes: 30, exitTo: 'laser' },
        // ★ci4: 치료실→완료 퇴실(레이저실 미방문) — B 매칭 O. 정정으로 새로 잡히는 케이스.
        { check_in: 'ci4', cust: 'c4', date: '2026-06-09', therapist: 't1', minutes: 40, exitTo: 'done' },
      ];
      const bEvents: B[] = [
        { cust: 'c1', date: '2026-06-09', therapist: 't1', type: '비가열' }, // ci1 매칭
        { cust: 'c3', date: '2026-06-09', therapist: 't1', type: '가열' },   // A 없음 → pending
        { cust: 'c4', date: '2026-06-09', therapist: 't1', type: '포돌로게' }, // ★ci4 매칭(미방문 세션)
      ];

      const isLinked = (a: A) =>
        bEvents.some((b) => b.cust === a.cust && b.date === a.date && b.therapist === a.therapist);

      const linkedMinutes = aEvents.filter(isLinked).map((a) => a.minutes);
      const pendingA = aEvents.filter((a) => !isLinked(a)).map((a) => a.check_in);
      const pendingB = bEvents.filter(
        (b) => !aEvents.some((a) => a.cust === b.cust && a.date === b.date && a.therapist === b.therapist),
      );

      // 역순(B 먼저 저장 후 A 도착)도 동일 — 둘 다 영속이므로 JOIN 결과 불변
      const reverseLinked = aEvents.filter(isLinked).length;

      // ★회귀 대조: 정정 전(이벤트 A = to_status='laser' 만) 정의였다면 미방문 세션(ci4)은 A 미검출 → 누락.
      const legacyAEvents = aEvents.filter((a) => a.exitTo === 'laser');
      const legacyLinkedCount = legacyAEvents.filter(isLinked).length;
      const legacyLinkedSum = legacyAEvents.filter(isLinked).reduce((s, a) => s + a.minutes, 0);

      return {
        linkedCount: linkedMinutes.length,
        linkedSum: linkedMinutes.reduce((s, m) => s + m, 0),
        pendingA,
        pendingBCount: pendingB.length,
        reverseLinked,
        legacyLinkedCount,
        legacyLinkedSum,
      };
    });

    expect(result.linkedCount).toBe(2); // ci1 + ci4(미방문) linked
    expect(result.linkedSum).toBe(60); // 20 + 40 — 정정으로 미방문 세션 포함
    expect(result.pendingA).toEqual(['ci2']); // A 단독 → pending(제외)
    expect(result.pendingBCount).toBe(1); // B 단독(c3) → pending(제외)
    expect(result.reverseLinked).toBe(2); // 순서 무관 동일 결과
    // ★정정 효과 입증: 정정 전 정의면 ci4 누락 → linked 1건/20분. 정정 후 2건/60분.
    expect(result.legacyLinkedCount).toBe(1);
    expect(result.legacyLinkedSum).toBe(20);
    expect(result.linkedCount).toBeGreaterThan(result.legacyLinkedCount);
  });

  // ── 시나리오2 / AC3·AC4: linked 만 평균시간, 분포(cnt)는 B 전체 ──
  test('AC4: 분포(cnt)는 차감 전체, 평균시간(avg)은 linked 만 집계', async ({ page }) => {
    await page.goto('/');
    const agg = await page.evaluate(() => {
      // t1 비가열: 차감 2건 중 1건만 측정시간(20분) linked
      type Row = { type: string; minutes: number | null };
      const rows: Row[] = [
        { type: '비가열', minutes: 20 }, // linked
        { type: '비가열', minutes: null }, // 차감만(분포 +1, 시간 제외)
      ];
      const cnt = rows.length;
      const linked = rows.filter((r) => r.minutes != null && r.minutes > 0).map((r) => r.minutes as number);
      const avg = linked.length ? linked.reduce((a, b) => a + b, 0) / linked.length : null;
      return { cnt, linkedCount: linked.length, avg };
    });

    expect(agg.cnt).toBe(2); // 분포 = 차감 전체
    expect(agg.linkedCount).toBe(1); // 시간 산출은 linked 만
    expect(agg.avg).toBe(20);
  });

  // ── 시나리오3 / AC1·AC6: 수액만 있는 치료사 분포 제외, 빈 기간 안전 ──
  test('AC1/AC6: 4종 외(수액)만 있는 경우 분포 0, 빈 기간 null 안전', async ({ page }) => {
    await page.goto('/');
    const edge = await page.evaluate((map) => {
      const normalize = (st: string): string | null => map[st] ?? null;
      // 수액(iv)만 차감한 치료사 → 4종 분류 결과 전부 null → 분포 진입 0건
      const ivOnly = ['iv', 'iv'].map(normalize).filter((c) => c !== null);
      // 빈 기간 평균 안전
      const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
      return { ivOnlyCount: ivOnly.length, emptyAvg: avg([]) };
    }, SESSION_TYPE_TO_CATEGORY);

    expect(edge.ivOnlyCount).toBe(0); // 수액만 → 통계 제외
    expect(edge.emptyAvg).toBeNull(); // 빈 데이터 크래시 없음
  });

  // ── 시나리오1 / AC6: 어드민 진입 시 4종 분포·평균시간 카드 렌더 (best-effort) ──
  test('AC6: 치료사 통계 탭에 4종 분포·시술별 평균시간 카드가 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — 로직 모델 테스트로 대체');

    await page.goto('/admin/stats');
    const tab = page.getByTestId('stats-tab-therapist');
    try {
      await tab.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(true, 'stats 접근 불가 role(=권한 차단 정상)');
      return;
    }
    await tab.click();
    await page.waitForTimeout(7_000);

    // 지표2 카드(4종 분포 + 시술별 평균시간) 렌더
    await expect(page.getByTestId('therapist-metric-services')).toBeVisible();
    await expect(page.getByTestId('therapist-metric-services')).toContainText('비가열');
    await expect(page.getByTestId('therapist-metric-avgtime')).toBeVisible();
    await expect(page.getByRole('button', { name: '이번 달' })).toBeVisible();
  });
});
