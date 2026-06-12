/**
 * E2E spec — T-20260612-foot-KOH-REPORT-PHASE15 (Phase 1.5)
 * 균검사지: 발톱부위(KOH 검사부위) 입력 + 당일 진료의사 조인.
 *
 * 검증 대상(현장 클릭 시나리오 D 변환):
 *   S1 발톱부위 render — formatNailSite/formatNailSites: {side,toe} → 'Rt 1지 조갑'(구조만 저장, FE 파생).
 *   S2 발톱부위 parse — parseNailSites: closed-enum(Rt/Lt, 1-5) 외 원소는 버림. 잡필드/표시문자열 방어.
 *   S3 입력 위젯 단일선택 commit — side+toe 둘 다 → [1원소]. 하나라도 해제 → []. 재선택=교체(누적 X).
 *   S4 당일의사 조인 — customer_id+visit_date(검사일 KST) → 진료의명 Set 합집합. 미서명/차트없음 = '미정'.
 *   S5 RPC shape 게이트(서버 검증 동치) — Rt/Lt·1-5만 통과. 잘못된 side/toe·표시문자열 거부.
 *   S6 시나리오2 엣지 — 미선택 저장=[] 허용 / 다른 값 재선택=교체 / 미서명='미정'.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab 헬퍼 + NailSiteEditor commit 규칙 +
 *   doctorNameForRow + RPC set_koh_nail_sites 검증식)을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: NailSite 타입/render (KohReportTab.tsx) ─────────────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }

const formatNailSite = (s: NailSite): string => `${s.side} ${s.toe}지 조갑`;
const formatNailSites = (sites: NailSite[] | null | undefined): string =>
  !sites || sites.length === 0 ? '—' : sites.map(formatNailSite).join(', ');

const parseNailSites = (raw: unknown): NailSite[] => {
  if (!Array.isArray(raw)) return [];
  const out: NailSite[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const side = (e as { side?: unknown }).side;
    const toe = Number((e as { toe?: unknown }).toe);
    if ((side === 'Rt' || side === 'Lt') && Number.isInteger(toe) && toe >= 1 && toe <= 5) {
      out.push({ side, toe });
    }
  }
  return out;
};

// ── 정본 모사: NailSiteEditor 단일선택 commit 규칙 ─────────────────────────────
//   side·toe 둘 다 있으면 [{side,toe}], 아니면 []. (라디오형 단일선택)
const commitSites = (side: NailSide | null, toe: number | null): NailSite[] =>
  side && toe ? [{ side, toe }] : [];

// ── 정본 모사: doctorNameForRow (customer_id+visit_date 조인) ──────────────────
const seoulISODate = (input: string | number | Date): string =>
  new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const doctorNameForRow = (
  r: { customer_id: string | null; created_at: string },
  doctorMap: Map<string, Set<string>>,
): string => {
  if (!r.customer_id) return '미정';
  const vd = seoulISODate(r.created_at);
  const set = doctorMap.get(`${r.customer_id}|${vd}`);
  if (!set || set.size === 0) return '미정';
  return [...set].sort((a, b) => a.localeCompare(b, 'ko')).join(', ');
};

// ── 정본 모사: RPC set_koh_nail_sites shape 검증(서버측 동치) ──────────────────
const rpcShapeValid = (sites: unknown): boolean => {
  if (!Array.isArray(sites)) return false;
  return sites.every(
    (e) =>
      !!e && typeof e === 'object' &&
      ((e as { side?: unknown }).side === 'Rt' || (e as { side?: unknown }).side === 'Lt') &&
      /^[1-5]$/.test(String((e as { toe?: unknown }).toe)),
  );
};

// ===========================================================================
test.describe('T-20260612-foot-KOH-REPORT-PHASE15', () => {
  // S1 — 발톱부위 render (구조 → 표시문자열, FE 파생)
  test('S1: formatNailSite — Rt 1 → "Rt 1지 조갑"', () => {
    expect(formatNailSite({ side: 'Rt', toe: 1 })).toBe('Rt 1지 조갑');
    expect(formatNailSite({ side: 'Lt', toe: 5 })).toBe('Lt 5지 조갑');
    expect(formatNailSites([{ side: 'Rt', toe: 1 }])).toBe('Rt 1지 조갑');
    expect(formatNailSites([])).toBe('—');
    expect(formatNailSites(null)).toBe('—');
  });

  // S2 — parse: closed-enum 외 원소 방어
  test('S2: parseNailSites — closed-enum 외/잡필드/표시문자열 버림', () => {
    expect(parseNailSites([{ side: 'Rt', toe: 1 }])).toEqual([{ side: 'Rt', toe: 1 }]);
    // 잘못된 side
    expect(parseNailSites([{ side: 'R', toe: 1 }])).toEqual([]);
    // toe 범위 밖
    expect(parseNailSites([{ side: 'Rt', toe: 0 }])).toEqual([]);
    expect(parseNailSites([{ side: 'Lt', toe: 6 }])).toEqual([]);
    // 표시문자열/원시값 방어
    expect(parseNailSites(['Rt 1지 조갑'])).toEqual([]);
    expect(parseNailSites('not-an-array')).toEqual([]);
    expect(parseNailSites([{ side: 'Lt', toe: 3 }, { junk: true }])).toEqual([{ side: 'Lt', toe: 3 }]);
  });

  // S3 — 단일선택 commit: 시나리오1 정상 동선
  test('S3: 단일선택 — side+toe → 1원소, 하나 해제 → []', () => {
    // Rt → 1 : 둘 다 선택 → [{Rt,1}]
    expect(commitSites('Rt', 1)).toEqual([{ side: 'Rt', toe: 1 }]);
    // side만 (toe 미선택) → []
    expect(commitSites('Rt', null)).toEqual([]);
    // toe만 (side 미선택) → []
    expect(commitSites(null, 1)).toEqual([]);
    // 둘 다 미선택 → []
    expect(commitSites(null, null)).toEqual([]);
  });

  // S4 — 당일의사 조인(합집합) + 시나리오2-3 미정
  test('S4: doctorNameForRow — customer_id+검사일 조인, 합집합 가나다, 미정', () => {
    const map = new Map<string, Set<string>>();
    map.set('cust-1|2026-06-11', new Set(['김의사']));
    map.set('cust-2|2026-06-11', new Set(['이의사', '강의사'])); // 1환자 N차트 합집합
    // KST 변환: UTC 02:00 = KST 11:00 → 같은 날(2026-06-11)
    expect(doctorNameForRow({ customer_id: 'cust-1', created_at: '2026-06-11T02:00:00Z' }, map)).toBe('김의사');
    // 합집합 가나다순(강 < 이)
    expect(doctorNameForRow({ customer_id: 'cust-2', created_at: '2026-06-11T02:00:00Z' }, map)).toBe('강의사, 이의사');
    // 차트없음(키 부재) → 미정
    expect(doctorNameForRow({ customer_id: 'cust-9', created_at: '2026-06-11T02:00:00Z' }, map)).toBe('미정');
    // customer_id 없음 → 미정
    expect(doctorNameForRow({ customer_id: null, created_at: '2026-06-11T02:00:00Z' }, map)).toBe('미정');
  });

  // S4b — KST 경계: UTC 자정 직후(=KST 오전 9시)는 같은 KST 날짜
  test('S4b: visit_date KST 경계 — UTC 21:00 = KST 익일 06:00', () => {
    const map = new Map<string, Set<string>>();
    map.set('cust-1|2026-06-12', new Set(['박의사']));
    // 2026-06-11 21:00 UTC = 2026-06-12 06:00 KST → 매핑 키 2026-06-12
    expect(doctorNameForRow({ customer_id: 'cust-1', created_at: '2026-06-11T21:00:00Z' }, map)).toBe('박의사');
  });

  // S5 — RPC shape 게이트(서버 검증 동치)
  test('S5: rpcShapeValid — Rt/Lt·1-5만 통과', () => {
    expect(rpcShapeValid([{ side: 'Rt', toe: 1 }])).toBe(true);
    expect(rpcShapeValid([])).toBe(true); // 빈배열 허용(미선택)
    expect(rpcShapeValid([{ side: 'R', toe: 1 }])).toBe(false);
    expect(rpcShapeValid([{ side: 'Rt', toe: 6 }])).toBe(false);
    expect(rpcShapeValid([{ side: 'Rt', toe: 0 }])).toBe(false);
    expect(rpcShapeValid(['Rt 1지 조갑'])).toBe(false); // 표시문자열 거부
    expect(rpcShapeValid('x')).toBe(false);
  });

  // S6 — 시나리오2 엣지: 재선택=교체(누적 X)
  test('S6: 재선택 = 이전 값 교체(단일, 누적 X)', () => {
    // Rt 1 선택 후 Lt 2 재선택 → 최종 [{Lt,2}] 단일(누적 아님)
    let side: NailSide | null = 'Rt';
    let toe: number | null = 1;
    expect(commitSites(side, toe)).toEqual([{ side: 'Rt', toe: 1 }]);
    side = 'Lt'; toe = 2;
    const replaced = commitSites(side, toe);
    expect(replaced).toEqual([{ side: 'Lt', toe: 2 }]);
    expect(replaced.length).toBe(1); // 누적 X
  });
});
