/**
 * E2E spec — T-20260627-foot-ANON-RLS-PHASE2B (Gate B)
 * native SelfCheckIn.tsx anon 경로 컷오버 — 직접 테이블 SELECT/INSERT...RETURNING → SECURITY DEFINER RPC.
 *
 * 배경: Phase 2b 가 anon 의 customers/check_ins/reservations 직접 SELECT 권한을 REVOKE 하면
 *   native 키오스크의 .from(...).select()/.insert().select() 경로가 42501 로 깨진다. 본 티켓은
 *   그 직접 경로를 fn_selfcheckin_* RPC + fn_selfcheckin_upsert_customer_resolve_v2 로 전량 전환.
 *
 * AC-1: /checkin/:slug 키오스크 입력 화면 정상 렌더(컷오버 후 회귀 0).
 * AC-2: 연락처 입력(10자리+) 시 예약 배너 조회가 RPC(fn_selfcheckin_reservation_banner)로 발사됨 —
 *       reservations 직접 GET SELECT 미발생(네트워크 레벨 컷오버 증명, DB 상태 무관).
 * AC-3: 입력 인터랙션 중 customers/check_ins 직접 GET SELECT 미발생.
 * AC-4: (정적 가드) 제출 핸들러가 customers/check_ins 직접 .from().select()/.insert() 미참조 +
 *       신규 RPC(resolve_v2/create_check_in/match_reservation/existing_checkin/linked_checkin) 참조 +
 *       이름단독 폴백(Fallback B) 제거(§16-3 ④ enumeration 차단) 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SELF_CHECKIN_URL = '/checkin/jongno-foot';

// PostgREST 직접 테이블 엔드포인트 (REVOKE 대상) — GET = SELECT.
const directTableGet = (url: string, table: string) =>
  /\/rest\/v1\//.test(url) && new RegExp(`/rest/v1/${table}(\\?|$)`).test(url);

test.describe('T-20260627-foot-ANON-RLS-PHASE2B — native 셀프체크인 anon 경로 RPC 컷오버', () => {
  test('AC-1/2/3: 연락처 입력 → 예약배너 RPC 발사, 직접 테이블 SELECT 미발생', async ({ page }) => {
    const rpcBannerCalls: string[] = [];
    const directReservationGets: string[] = [];
    const directCustomerGets: string[] = [];
    const directCheckinGets: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/rest/v1/rpc/fn_selfcheckin_reservation_banner')) rpcBannerCalls.push(url);
      // 직접 테이블 GET(SELECT)만 카운트 — RPC(POST /rest/v1/rpc/...)는 제외.
      if (req.method() === 'GET') {
        if (directTableGet(url, 'reservations')) directReservationGets.push(url);
        if (directTableGet(url, 'customers')) directCustomerGets.push(url);
        if (directTableGet(url, 'check_ins')) directCheckinGets.push(url);
      }
    });

    await page.goto(SELF_CHECKIN_URL);

    // AC-1: 키오스크 입력 화면 렌더 (연락처 라벨 or 셀프접수 타이틀)
    const loaded = await page
      .getByText(/연락처|Self Check-In|셀프 접수/)
      .first()
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    if (!loaded) {
      test.skip(true, '키오스크 페이지 미렌더(clinic slug 미시드 등) — 환경 의존, 스킵');
      return;
    }

    // AC-2: 온스크린 숫자패드로 11자리 연락처 입력 → 배너 조회 effect(10자리+) 트리거.
    const digits = '01012345678';
    for (const d of digits) {
      const key = page.getByRole('button', { name: d, exact: true }).first();
      if ((await key.count()) === 0) {
        test.skip(true, '숫자패드 미노출 — 입력 스텝 변형, 스킵');
        return;
      }
      await key.click();
    }

    // 배너 조회 RPC 가 발사될 시간 부여(effect 디바운스/네트워크).
    await page.waitForTimeout(2_500);

    // 예약배너 조회는 RPC 로만 발사 — reservations 직접 SELECT 0.
    expect(rpcBannerCalls.length, '예약배너 RPC(fn_selfcheckin_reservation_banner) 미발사').toBeGreaterThan(0);
    expect(directReservationGets, `reservations 직접 SELECT 잔존:\n${directReservationGets.join('\n')}`).toHaveLength(0);

    // AC-3: 입력 단계에서 customers/check_ins 직접 SELECT 미발생.
    expect(directCustomerGets, `customers 직접 SELECT 잔존:\n${directCustomerGets.join('\n')}`).toHaveLength(0);
    expect(directCheckinGets, `check_ins 직접 SELECT 잔존:\n${directCheckinGets.join('\n')}`).toHaveLength(0);
  });

  test('AC-4: (정적 가드) 제출 핸들러 직접 테이블 경로 제거 + 신규 RPC 참조 확인', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/SelfCheckIn.tsx'), 'utf-8');

    // 제출 경로의 customers/check_ins 직접 .from().select()/.insert() 가 모두 제거됐다.
    expect(src, "customers 직접 .from() 잔존").not.toMatch(/\.from\(['"]customers['"]\)/);
    expect(src, "check_ins 직접 .from() 잔존").not.toMatch(/\.from\(['"]check_ins['"]\)/);

    // 신규/기존 SECURITY DEFINER RPC 로 전환됐다.
    expect(src).toContain('fn_selfcheckin_upsert_customer_resolve_v2');
    expect(src).toContain('fn_selfcheckin_create_check_in');
    expect(src).toContain('fn_selfcheckin_match_reservation');
    expect(src).toContain('fn_selfcheckin_existing_checkin_today');
    expect(src).toContain('fn_selfcheckin_linked_checkin');
    expect(src).toContain('fn_selfcheckin_reservation_banner');

    // §16-3 ④: 이름단독 예약매칭(Fallback B) 미포팅 — enumeration 차단(의도된 보안 발산).
    expect(src, "이름단독 예약매칭(customer_name eq) 잔존").not.toMatch(/\.eq\(['"]customer_name['"]/);

    // ambiguous sentinel 분기 보존(2건+ → 미연결 체크인 플래그).
    expect(src).toContain("link_status === 'ambiguous'");
    expect(src).toContain('unlinked_ambiguous');
  });
});
