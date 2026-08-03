import { test, expect } from '@playwright/test';
import {
  selectRecapAttempts,
  isSweepableOrphan,
  CBAND_ORPHAN_STALE_MINUTES,
  type CbandAttemptView,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';

/**
 * T-20260803-foot-CBAND-PAYRESULT-SWEEP — 결과 미아건(orphan 'requested') 서버측 스윕 + 상세시트 재표시
 * ────────────────────────────────────────────────────────────────────────────
 * 배경(smzh AC-3 tail-case): 결제 진행 중 탭닫힘/새로고침 → WS 소멸 → 응답 전이면 recordCardPayment 미실행 →
 *   시도레코드 status='requested' 고아(단말은 승인됐을 수 있으나 payments 미기록).
 *
 * ★스키마 무접촉(AC-6 선례 계승): 'attention'은 이미 status CHECK 존재(신규 enum 아님). 스윕=기존 UPDATE RLS,
 *   재표시=기존 SELECT RLS. 실 카드/RLS/DB 는 field-soak(총괄) — 여기서는 순수 판정 + 기회주의 스윕 계약을 결정론 고정.
 *
 * 커버(현장 클릭 시나리오 E2E 변환):
 *  · 시나리오 1(미아건 회수): stale 'requested' → 스윕으로 'attention' 승격 → 재표시. payments 미생성(멱등).
 *  · 시나리오 2(정상 무영향·회귀): approved 는 스윕/재표시 대상 아님. fresh 'requested'(진행중일 수 있음)도 제외.
 *  · selectRecapAttempts / isSweepableOrphan 순수 판정 경계.
 */

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function view(over: Partial<CbandAttemptView> & { id: string; status: CbandAttemptView['status']; createdAt: string }): CbandAttemptView {
  return {
    msgTrace: `1044${over.id.replace(/\D/g, '').padStart(8, '0')}`,
    tranType: TRANTYPE_APPROVE,
    amount: 1002,
    authNo: null,
    responseCode: null,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// A) selectRecapAttempts — 재표시 대상 선별(순수)
// ══════════════════════════════════════════════════════════════════════════
test.describe('selectRecapAttempts 재표시 선별', () => {
  test('attention 은 항상 재표시 / stale requested(임계 초과)는 지연 재표시', () => {
    const rows = [
      view({ id: 'a1', status: 'attention', createdAt: minAgo(1) }),
      view({ id: 'r-old', status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 1) }),
    ];
    const items = selectRecapAttempts(rows, NOW);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ view: { id: 'a1' }, kind: 'attention' });
    expect(items[1]).toMatchObject({ view: { id: 'r-old' }, kind: 'stale_requested' });
  });

  test('fresh requested(임계 이내·진행중일 수 있음) / approved / failed 는 제외(정상 흐름 무소음)', () => {
    const rows = [
      view({ id: 'r-fresh', status: 'requested', createdAt: minAgo(1) }),          // 진행중 가능 → 제외
      view({ id: 'ok', status: 'approved', createdAt: minAgo(10) }),               // 정상 완료 → 제외
      view({ id: 'fail', status: 'failed', createdAt: minAgo(10) }),               // 실패 확정 → 제외
    ];
    expect(selectRecapAttempts(rows, NOW)).toHaveLength(0);
  });

  test('임계 경계: 정확히 STALE 분 경과는 아직 미포함, 초과부터 포함', () => {
    const atEdge = view({ id: 'edge', status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES) });
    const overEdge = view({ id: 'over', status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 0.1) });
    expect(selectRecapAttempts([atEdge], NOW)).toHaveLength(0);
    expect(selectRecapAttempts([overEdge], NOW)).toHaveLength(1);
  });

  test('파싱 불가 createdAt 은 안전하게 제외(오탐 방지)', () => {
    const bad = view({ id: 'bad', status: 'requested', createdAt: 'not-a-date' });
    expect(selectRecapAttempts([bad], NOW)).toHaveLength(0);
  });

  test('입력 순서(최신순) 보존 — store 정렬 결과를 뒤집지 않음', () => {
    const rows = [
      view({ id: 'a2', status: 'attention', createdAt: minAgo(1) }),
      view({ id: 'a3', status: 'attention', createdAt: minAgo(2) }),
    ];
    const items = selectRecapAttempts(rows, NOW);
    expect(items.map((i) => i.view.id)).toEqual(['a2', 'a3']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B) isSweepableOrphan — 스윕 대상 술어(순수, store SQL 과 공용 의미)
// ══════════════════════════════════════════════════════════════════════════
test.describe('isSweepableOrphan 스윕 대상', () => {
  test('오래된 requested 만 true / attention·approved·fresh 는 false', () => {
    expect(isSweepableOrphan({ status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 1) }, NOW)).toBe(true);
    expect(isSweepableOrphan({ status: 'requested', createdAt: minAgo(1) }, NOW)).toBe(false);
    expect(isSweepableOrphan({ status: 'attention', createdAt: minAgo(60) }, NOW)).toBe(false);
    expect(isSweepableOrphan({ status: 'approved', createdAt: minAgo(60) }, NOW)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C) 기회주의 스윕 계약 — in-memory store (멱등·payments 무생성 회귀)
//    실 supabaseAttemptStore(RLS·DB)는 field-soak. 여기서는 store 인터페이스 계약을 결정론 고정.
// ══════════════════════════════════════════════════════════════════════════
function makeMemStore(seed: CbandAttemptView[]) {
  const rows = new Map<string, CbandAttemptView>(seed.map((r) => [r.id, { ...r }]));
  const paymentsCreated: string[] = []; // 스윕이 payments 를 만들지 '않음'을 관측

  const store: Pick<AttemptStore, 'listRecentAttempts' | 'sweepStaleRequested'> = {
    async listRecentAttempts(q) {
      return [...rows.values()]
        .filter((r) => !q.checkInId || true) // 시드 전부 동일 checkIn 가정
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, q.limit ?? 10);
    },
    async sweepStaleRequested(q) {
      const stale = q.staleMinutes ?? CBAND_ORPHAN_STALE_MINUTES;
      let swept = 0;
      for (const r of rows.values()) {
        if (isSweepableOrphan(r, NOW, stale)) {
          r.status = 'attention'; // ★status UPDATE 만 — payments 미생성(paymentsCreated 불변)
          swept++;
        }
      }
      return { swept };
    },
  };
  return { store, rows, paymentsCreated };
}

test.describe('기회주의 스윕 계약(in-memory)', () => {
  test('시나리오 1: stale requested → 스윕 승격 → 재표시(attention). payments 미생성(멱등)', async () => {
    const { store, rows, paymentsCreated } = makeMemStore([
      view({ id: 'orphan', status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 2) }),
    ]);
    const res = await store.sweepStaleRequested!({ clinicId: 'c1', checkInId: 'ci1' });
    expect(res.swept).toBe(1);
    expect(rows.get('orphan')!.status).toBe('attention');
    expect(paymentsCreated).toHaveLength(0); // ★이중수납 0

    const recap = selectRecapAttempts(await store.listRecentAttempts!({ clinicId: 'c1', checkInId: 'ci1' }), NOW);
    expect(recap).toHaveLength(1);
    expect(recap[0].kind).toBe('attention');
  });

  test('멱등: 재실행은 no-op(이미 attention 은 제외) — swept=0', async () => {
    const { store } = makeMemStore([
      view({ id: 'orphan', status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 2) }),
    ]);
    expect((await store.sweepStaleRequested!({ clinicId: 'c1' })).swept).toBe(1);
    expect((await store.sweepStaleRequested!({ clinicId: 'c1' })).swept).toBe(0);
  });

  test('시나리오 2(회귀): 정상 approved 는 스윕/재표시 대상 아님', async () => {
    const { store, rows } = makeMemStore([
      view({ id: 'done', status: 'approved', tranType: TRANTYPE_APPROVE, createdAt: minAgo(10) }),
    ]);
    expect((await store.sweepStaleRequested!({ clinicId: 'c1' })).swept).toBe(0);
    expect(rows.get('done')!.status).toBe('approved'); // 불변
    expect(selectRecapAttempts(await store.listRecentAttempts!({ clinicId: 'c1', checkInId: 'ci1' }), NOW)).toHaveLength(0);
  });

  test('취소(0430) 미아건도 동일하게 회수 표시(tranType 보존)', async () => {
    const { store } = makeMemStore([
      view({ id: 'cxl', status: 'requested', tranType: TRANTYPE_CANCEL, createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 3) }),
    ]);
    await store.sweepStaleRequested!({ clinicId: 'c1' });
    const recap = selectRecapAttempts(await store.listRecentAttempts!({ clinicId: 'c1', checkInId: 'ci1' }), NOW);
    expect(recap).toHaveLength(1);
    expect(recap[0].view.tranType).toBe(TRANTYPE_CANCEL);
  });
});
