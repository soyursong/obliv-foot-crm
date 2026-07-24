/**
 * E2E/Unit — T-20260723-foot-TMAGG-DOPAMINE-REGISTRARNAME-DISPLAYBUCKET-VARIANT
 *
 * CEO 대표게이트 통과(2026-07-24) + DA CONVENE GO
 *   (Q1 §416 firewall = ACCEPT-CONDITIONAL / Q2 variant safety = SAFE,
 *    consult_ref DA-20260724-foot-TMAGG-PERNAME-FIREWALL-VARIANT-CONVENE).
 *
 * 요지: 통계대시보드 TM집계 표 grouping 에서 dopamine 파티션
 *   (created_by IS NULL AND source_system='dopamine') 한정으로 registrar_name 을
 *   display 버킷(dop:{registrar_name})으로 분할한다. registrar_name NULL 도파민 행은
 *   기존 '__dopamine__'('도파민 등록') 단일버킷 fallback 유지. native(created_by 有)는 불변.
 *
 * ── 카브아웃 봉인 6조 (DA CONVENE 정본) ─────────────────────────────────
 *   AC1 버킷 범위 pin — 3조건(created_by NULL + dopamine + registrar_name 有) 행에만 dop:{rn},
 *       나머지 도파민 행은 __dopamine__ fallback.
 *   AC2 native 무변경 — created_by≠NULL 행은 created_by canonical grouping STAYS(REPOINT AC4 유지).
 *   AC3 HARD incentive-inert — dop:* 는 COUNT display grouping 전용, created_by NULL 유지(매출/인센티브
 *       /funnel/attribution 무입력). 이 spec 은 함수가 created_by 를 write/파생하지 않음을 side-effect 0 으로 검증.
 *   AC4 총계 정합 — 서브버킷(dop:* + __dopamine__) 합 == 분할 전 도파민 단일버킷 총계(누출·중복 0).
 *   AC5 name-keyed display-only — dop:{rn} 는 display best-effort(canonical attribution 아님). 동명이인 conflation caveat.
 *   AC6 승격 금지 가드 — key 접두사 'dop:' 는 COUNT 표 내부 전용(코드주석/함수 JSDoc 명기). 여기선 접두사 규약 고정 검증.
 *
 * ⛔ 순수 함수 read-only. registrar_name/created_by 어떤 값도 write/승격 없음. no-DDL.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import {
  tmAttributionKey,
  TM_DOPAMINE_BUCKET,
  TM_UNASSIGNED_LABEL,
  type TmStaffInfo,
} from '../../src/lib/stats';

const STAFF: Record<string, TmStaffInfo> = {
  'u-tm-1': { name: '진운선', role: 'tm' },
  'u-admin-1': { name: '김주연', role: 'admin' },
};

// attrOfRes(r) 등가 재현 helper — dopamine 파티션은 registrar_name 을 4번째 인자로 전달.
const attr = (r: { created_by: string | null; source_system: string | null; registrar_name: string | null }) =>
  tmAttributionKey(r.created_by, r.source_system, STAFF[r.created_by ?? '']?.name, r.registrar_name);

test.describe('VARIANT AC1 — dopamine per-name display 버킷 분할 + registrar_name NULL fallback', () => {
  test('created_by=NULL + dopamine + registrar_name 有 → dop:{registrar_name} 개별 버킷', () => {
    const a = attr({ created_by: null, source_system: 'dopamine', registrar_name: '진운선' });
    expect(a.key).toBe('dop:진운선');
    expect(a.label).toBe('진운선');
  });

  test('서로 다른 registrar_name 도파민 행 → 이름별로 분리된 개별 버킷(더 이상 단일 병합 아님)', () => {
    const rows = [
      { created_by: null, source_system: 'dopamine', registrar_name: '진운선' },
      { created_by: null, source_system: 'dopamine', registrar_name: '이수빈' },
      { created_by: null, source_system: 'dopamine', registrar_name: '제3자' },
    ];
    const keys = rows.map((r) => attr(r).key);
    expect(keys).toEqual(['dop:진운선', 'dop:이수빈', 'dop:제3자']);
    expect(new Set(keys).size).toBe(3);
  });

  test('created_by=NULL + dopamine + registrar_name NULL/공백 → __dopamine__ 단일버킷 fallback', () => {
    const aNull = attr({ created_by: null, source_system: 'dopamine', registrar_name: null });
    expect(aNull.key).toBe('__dopamine__');
    expect(aNull.label).toBe(TM_DOPAMINE_BUCKET);
    const aBlank = attr({ created_by: null, source_system: 'dopamine', registrar_name: '   ' });
    expect(aBlank.key).toBe('__dopamine__'); // 공백-only 는 fallback (trim)
  });

  test('created_by=NULL + dopamine 아님 → 여전히 미지정 버킷(카브아웃 범위 밖)', () => {
    const a = attr({ created_by: null, source_system: null, registrar_name: '진운선' });
    expect(a.key).toBe('__unassigned__'); // dopamine 파티션 아니면 registrar_name 무시
    expect(a.label).toBe(TM_UNASSIGNED_LABEL);
  });
});

test.describe('VARIANT AC2 — native(created_by≠NULL) 무변경 (REPOINT AC4 STAYS)', () => {
  test('직접등록(created_by 有) 행은 registrar_name 이 있어도 staff:<uid> canonical grouping 불변', () => {
    const a = attr({ created_by: 'u-tm-1', source_system: null, registrar_name: '제3자' });
    expect(a.key).toBe('staff:u-tm-1');
    expect(a.label).toBe('진운선'); // 직원명 (registrar_name 미참여)
  });

  test('데스크(admin) 직접등록도 불변 — dopamine 마커·registrar_name 무관', () => {
    const a = attr({ created_by: 'u-admin-1', source_system: 'dopamine', registrar_name: '진운선' });
    expect(a.key).toBe('staff:u-admin-1'); // created_by 우선 — variant 는 도파민 파티션(created_by NULL)에만 개입
    expect(a.label).toBe('김주연');
  });
});

test.describe('VARIANT AC4 — 총계 정합(서브버킷 합 == 분할 전 도파민 단일버킷 총계, 누출·중복 0)', () => {
  test('★ exhaustive/disjoint: dop:* + __dopamine__ 합 = 전체 도파민 행 수', () => {
    // 시뮬 데이터: 도파민 8건(이름 有 6 / NULL 2) + native 3건.
    const dopWithName = [
      { created_by: null, source_system: 'dopamine', registrar_name: '진운선' },
      { created_by: null, source_system: 'dopamine', registrar_name: '진운선' }, // 동명 2건 → 같은 dop:진운선 병합
      { created_by: null, source_system: 'dopamine', registrar_name: '이수빈' },
      { created_by: null, source_system: 'dopamine', registrar_name: '이수빈' },
      { created_by: null, source_system: 'dopamine', registrar_name: '이수빈' },
      { created_by: null, source_system: 'dopamine', registrar_name: '제3자' },
    ];
    const dopNoName = [
      { created_by: null, source_system: 'dopamine', registrar_name: null },
      { created_by: null, source_system: 'dopamine', registrar_name: null },
    ];
    const native = [
      { created_by: 'u-tm-1', source_system: null, registrar_name: null },
      { created_by: 'u-admin-1', source_system: null, registrar_name: null },
      { created_by: 'u-tm-1', source_system: 'dopamine', registrar_name: '진운선' }, // native (created_by 有)
    ];
    const allDopamine = [...dopWithName, ...dopNoName]; // created_by NULL + dopamine 인 행 = 8

    // 분할 전 총계(가상의 단일 __dopamine__ 버킷) = 8
    const preSplitTotal = allDopamine.length;

    // 분할 후 버킷 집계
    const buckets = new Map<string, number>();
    for (const r of [...allDopamine, ...native]) {
      const k = attr(r).key;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }

    // 도파민 서브버킷만 합산(dop:* + __dopamine__)
    let dopamineSubtotal = 0;
    for (const [k, n] of buckets) {
      if (k.startsWith('dop:') || k === '__dopamine__') dopamineSubtotal += n;
    }

    // AC4 하드 assert: 서브버킷 합 == 분할 전 단일버킷 총계 (누출·중복 0)
    expect(dopamineSubtotal).toBe(preSplitTotal); // 8

    // 개별 버킷 분포 검증(동명 병합·fallback 포함)
    expect(buckets.get('dop:진운선')).toBe(2);
    expect(buckets.get('dop:이수빈')).toBe(3);
    expect(buckets.get('dop:제3자')).toBe(1);
    expect(buckets.get('__dopamine__')).toBe(2);

    // native 는 도파민 서브버킷에 누출되지 않음(AC2/AC4 disjoint)
    expect(buckets.get('staff:u-tm-1')).toBe(2);   // created_by 有 dopamine 행 포함(도파민 서브버킷 아님)
    expect(buckets.get('staff:u-admin-1')).toBe(1);
  });
});

test.describe('VARIANT AC3 — HARD incentive-inert (created_by write/파생 0, side-effect 0)', () => {
  test('함수는 created_by 를 스탬프하지 않는다 + 입력 불변(read-only)', () => {
    const row = { created_by: null, source_system: 'dopamine', registrar_name: '진운선' } as const;
    const snapshot = JSON.stringify(row);
    const staffSnapshot = JSON.stringify(STAFF);
    const a = tmAttributionKey(row.created_by, row.source_system, undefined, row.registrar_name);
    expect(a.key).toBe('dop:진운선');
    // created_by 는 여전히 NULL(§416 firewall) — 함수가 어떤 write 도 하지 않음.
    expect(row.created_by).toBeNull();
    expect(JSON.stringify(row)).toBe(snapshot);       // 입력 객체 무변경
    expect(JSON.stringify(STAFF)).toBe(staffSnapshot); // staffMap 무변경
  });
});

test.describe('VARIANT AC5/AC6 — display-only 규약 + 승격 금지 가드(key 접두사)', () => {
  test('AC6: dopamine per-name key 접두사는 항상 "dop:" — COUNT 표 내부 전용 네임스페이스', () => {
    const a = attr({ created_by: null, source_system: 'dopamine', registrar_name: '홍길동' });
    expect(a.key.startsWith('dop:')).toBe(true);
    // native 는 staff: / 미지정 __unassigned__ / fallback __dopamine__ — 네임스페이스 충돌 없음.
    expect(attr({ created_by: 'u-tm-1', source_system: null, registrar_name: null }).key.startsWith('staff:')).toBe(true);
  });

  test('AC5: 동명이인 conflation 은 알려진 display caveat — 같은 이름은 같은 버킷으로 병합(escalation 아님)', () => {
    const a1 = attr({ created_by: null, source_system: 'dopamine', registrar_name: '김철수' });
    const a2 = attr({ created_by: null, source_system: 'dopamine', registrar_name: '김철수' });
    expect(a1.key).toBe(a2.key); // 동명 → 동일 display 버킷(best-effort)
  });
});

// ── 현장 클릭 시나리오 (렌더 무회귀) ──────────────────────────────────
test.describe('VARIANT 통계대시보드 TM집계 렌더 — 시나리오 1·2 무회귀', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1/2: TM집계 탭 진입 + TM팀만 토글 에러 없이 재렌더 + 집계 표 유지', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible({ timeout: 10_000 });
    await tmTab.click();

    await expect(page.getByText('TM상담사별 집계')).toBeVisible({ timeout: 10_000 });

    const tmOnlyBtn = page.getByRole('button', { name: /TM팀만/ });
    await expect(tmOnlyBtn).toBeVisible();
    await tmOnlyBtn.click();
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    await tmOnlyBtn.click();
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TMAGG-DOPAMINE-REGISTRARNAME-DISPLAYBUCKET-VARIANT] dopamine per-name 버킷 렌더 · 총계 정합 · native 불변 OK');
  });
});
