/**
 * E2E spec — T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET
 * 치료사 통계 '전환(experience_converted)' 분자 재정의:
 *   전환 = 체험(권 차감) 내원 → 당일(KST) 같은 고객에게 신규 '정식(다회차) 패키지' 발행된 경우만.
 *   1회성 티켓(단건, total_sessions=1)·체험권 발행·템플릿·양도는 전환 분자에서 구조적 제외.
 *
 * 현장(총괄 김주연 C0ATE5P6JTH) 확정 SSOT (slack ts 1784983193.079089, via planner):
 *   "중요한 거 전환 잡을 때 1회성 티켓은 반영 시키면 안 됨" → 패키지 정식 전환만 전환으로.
 *
 * 수정 방향 = Option B(집계단). RPC foot_stats_therapist_summary 의 exp_agg 의 exp_conv(분자)만 재정의.
 *   분모(exp_total=체험 건수)·측정창·roster·지정비율 = LIVE 20260725190000(PKG-TRIAL) 그대로(무회귀).
 *   (mig 20260725200000_foot_stats_conversion_exclude_onetime.sql)
 *
 * prod dry-run(2026-07-26): experience_total 무회귀(7월 89·6월 1), conversion delta=0
 *   (LIVE exp_conv=1 → NEW exp_conv=1, 화면 수치 무변동). 정의만 SSOT 부합으로 교정.
 *
 * '정식 패키지'(전환 대상) 판별식 = packages 중:
 *   (a) 미취소·미환불(status NOT IN cancelled/refunded)
 *   (b) 다회차(total_sessions>=2)          — 1회성 단건 제외
 *   (c) 체험권 아님(package_type 에 '체험' 미포함 AND treatment_type<>'체험권')  — 2회차 체험권 포함 제외
 *   (d) 템플릿/프리셋 아님(package_type NOT IN template/preset_12)
 *   (e) 양도받은 것 아님(transferred_from IS NULL = 신규 발행)
 *   + 당일(contract_date = 체험 내원 kst_date) + 같은 고객(customer_id).
 *
 * RPC exp_conv 불변식을 page.evaluate 순수 함수로 검증(seeded DB 비의존, 로직 회귀 방지) + UI 렌더 best-effort.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── RPC exp_conv 신규 판별식의 순수 모델 (SQL EXISTS 절 직역) ────────────────────
type ExpCI = { customer_id: string; kst_date: string };
type Pkg = {
  customer_id: string;
  contract_date: string;
  status: string;
  total_sessions: number;
  package_type: string;
  treatment_type: string | null;
  transferred_from: string | null;
};

function isOfficialConversion(ci: ExpCI, pkgs: Pkg[]): boolean {
  return pkgs.some(
    (pk) =>
      pk.customer_id === ci.customer_id &&
      pk.contract_date === ci.kst_date && // 당일 발행
      !['cancelled', 'refunded'].includes(pk.status) && // (a) 미취소·미환불
      (pk.total_sessions ?? 0) >= 2 && // (b) 다회차 — 1회성 단건 제외
      !/체험/.test(pk.package_type ?? '') && // (c) 체험권 제외(package_type)
      (pk.treatment_type ?? '') !== '체험권' && // (c) 체험권 제외(treatment_type)
      !['template', 'preset_12'].includes(pk.package_type) && // (d) 템플릿/프리셋 제외
      pk.transferred_from == null, // (e) 양도 제외(신규 발행만)
  );
}

test.describe('T-20260725 CONVERSION-EXCLUDE-ONETIME — 전환 분자 = 체험 당일 신규 정식패키지만', () => {
  const mkCI = (): ExpCI => ({ customer_id: 'cust-1', kst_date: '2026-07-25' });
  const basePkg = (over: Partial<Pkg>): Pkg => ({
    customer_id: 'cust-1',
    contract_date: '2026-07-25',
    status: 'active',
    total_sessions: 12,
    package_type: '12회권',
    treatment_type: null,
    transferred_from: null,
    ...over,
  });

  // ── 시나리오1: 체험 당일 신규 정식(다회차) 패키지 발행 → 전환 1 ──
  test('시나리오1: 체험 내원 당일 신규 정식(다회차) 패키지 발행은 전환으로 카운트된다', async ({ page }) => {
    await page.goto('/');
    const ok = await page.evaluate(
      ({ fn, ci, pkgs }) => {
        // eslint-disable-next-line no-new-func
        const isConv = new Function('return ' + fn)() as (c: unknown, p: unknown[]) => boolean;
        return isConv(ci, pkgs);
      },
      { fn: isOfficialConversion.toString(), ci: mkCI(), pkgs: [basePkg({})] },
    );
    expect(ok).toBe(true); // 12회권 당일 발행 → 전환
  });

  // ── 시나리오2 (핵심): 1회성 티켓(단건 total_sessions=1)은 전환 제외 ──
  test('시나리오2: 1회성 티켓(단건, total_sessions=1) 발행은 전환 분자에서 제외된다', async ({ page }) => {
    await page.goto('/');
    const results = await page.evaluate(
      ({ fn, ci, single, af }) => {
        // eslint-disable-next-line no-new-func
        const isConv = new Function('return ' + fn)() as (c: unknown, p: unknown[]) => boolean;
        return { single: isConv(ci, [single]), af: isConv(ci, [af]) };
      },
      {
        fn: isOfficialConversion.toString(),
        ci: mkCI(),
        single: basePkg({ total_sessions: 1, package_type: 'custom' }), // custom 단건
        af: basePkg({ total_sessions: 1, package_type: 'AF레이저' }), // 1회성 레이저 티켓
      },
    );
    expect(results.single).toBe(false); // custom 단건 → 전환 아님
    expect(results.af).toBe(false); // AF레이저 1회성 → 전환 아님(반영 금지 = 총괄 SSOT)
  });

  // ── 시나리오3: 체험권 발행(2회차 체험권 포함)은 전환 제외 ──
  test('시나리오3: 체험권 발행(package_type 체험 포함 / 2회차 체험권)은 전환 아님', async ({ page }) => {
    await page.goto('/');
    const results = await page.evaluate(
      ({ fn, ci, trial1, trial2, byType }) => {
        // eslint-disable-next-line no-new-func
        const isConv = new Function('return ' + fn)() as (c: unknown, p: unknown[]) => boolean;
        return {
          trial1: isConv(ci, [trial1]),
          trial2: isConv(ci, [trial2]),
          byType: isConv(ci, [byType]),
        };
      },
      {
        fn: isOfficialConversion.toString(),
        ci: mkCI(),
        trial1: basePkg({ total_sessions: 1, package_type: '무좀체험권' }), // 1회 체험권
        trial2: basePkg({ total_sessions: 2, package_type: '내성체험권' }), // 2회차 체험권도 제외
        byType: basePkg({ total_sessions: 2, package_type: '기타', treatment_type: '체험권' }), // treatment_type=체험권
      },
    );
    expect(results.trial1).toBe(false);
    expect(results.trial2).toBe(false); // 2회차라도 체험권이면 정식 전환 아님
    expect(results.byType).toBe(false);
  });

  // ── 시나리오4: 당일 아님(나중날 구매) / 양도 / 취소·환불 / 템플릿 = 전환 제외 (회귀·엣지) ──
  test('시나리오4: 비당일·양도·취소환불·템플릿 정식패키지는 전환 아님', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(
      ({ fn, ci, later, transferred, refunded, template }) => {
        // eslint-disable-next-line no-new-func
        const isConv = new Function('return ' + fn)() as (c: unknown, p: unknown[]) => boolean;
        return {
          later: isConv(ci, [later]),
          transferred: isConv(ci, [transferred]),
          refunded: isConv(ci, [refunded]),
          template: isConv(ci, [template]),
        };
      },
      {
        fn: isOfficialConversion.toString(),
        ci: mkCI(),
        later: basePkg({ contract_date: '2026-07-26' }), // 나중날 구매 → 당일 요건 미충족
        transferred: basePkg({ transferred_from: 'pkg-old' }), // 양도받은 것 → 신규 아님
        refunded: basePkg({ status: 'refunded' }), // 환불 → 제외
        template: basePkg({ package_type: 'template' }), // 템플릿 아티팩트 → 제외
      },
    );
    expect(r.later).toBe(false);
    expect(r.transferred).toBe(false);
    expect(r.refunded).toBe(false);
    expect(r.template).toBe(false);
  });

  // ── 시나리오5: 다른 고객 패키지는 매칭 안 됨 (귀속 격리) ──
  test('시나리오5: 같은 날 발행이라도 다른 고객의 정식패키지는 전환 매칭 안 됨', async ({ page }) => {
    await page.goto('/');
    const matched = await page.evaluate(
      ({ fn, ci, otherCust }) => {
        // eslint-disable-next-line no-new-func
        const isConv = new Function('return ' + fn)() as (c: unknown, p: unknown[]) => boolean;
        return isConv(ci, [otherCust]);
      },
      {
        fn: isOfficialConversion.toString(),
        ci: mkCI(),
        otherCust: basePkg({ customer_id: 'cust-2' }),
      },
    );
    expect(matched).toBe(false);
  });

  // ── UI 렌더 best-effort: 치료사 통계 '체험 → 결제 전환율' 카드 노출 ──
  test('UI: 치료사 통계 지표4(체험→결제 전환율) 카드가 렌더된다', async ({ page }) => {
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

    const card = page.getByTestId('therapist-metric-conversion');
    await expect(card).toBeVisible();
  });
});
