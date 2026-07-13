import { supabase } from './supabase';
import { seoulISODate, todaySeoulISODate } from './format';
import type { VisitType } from './types';

/**
 * T-20260706-foot-INTAKE-REVISIT-JUDGE-365
 *
 * 초진/재진 분류 기준을 stored customers.visit_type(=완료 시 영구 'returning' 승격)에서
 * **동적 365일 recency 판정(서버 KST)** 으로 교체한다. 대표 확정(MSG-jo9e, B안 + 365일) 근거.
 *
 *   재진(returning)  = 최근 '완료(done)' 방문일 기준 365일 이내(경계 포함)
 *   초진취급(new)     = 365일 초과 · 완료이력 무(無)
 *
 * 종로 오리진점 풋센터 한정 — 완료방문 조회를 현재 클리닉(clinicId)으로 스코프해
 * 타 지점 방문이 풋센터 재진 판정에 섞이지 않게 한다.
 *
 * ⚠ 라우팅 목적지(상담대기 vs 치료대기) 매핑은 불변 — 여기서는 '분류 기준'만 바꾼다.
 * ⚠ db_change 없음(무-DDL) — check_ins 완료행을 읽어 클라이언트에서 판정.
 */

/** 재진 판정 윈도우(일). 최근 완료방문이 이 값 이내면 재진, 초과면 초진취급. */
export const RETURNING_WINDOW_DAYS = 365;

/**
 * 두 KST 날짜(YYYY-MM-DD) 사이 경과 일수 = todayISO - lastISO.
 * UTC 자정으로 정규화해 밀리초 차 → 일수로 환산한다(로컬 타임존/서머타임 무영향).
 * 잘못된 입력이면 NaN 반환(호출부에서 무이력과 동일 처리).
 */
export function diffDaysISO(lastISO: string, todayISO: string): number {
  const a = Date.parse(`${lastISO}T00:00:00Z`);
  const b = Date.parse(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/**
 * 순수 판정 함수 — 최근 완료방문 KST 날짜(YYYY-MM-DD)와 오늘 KST 날짜로 초진/재진을 판정.
 *
 * 경계값(off-by-one) 규약:
 *   diff <= 365 → 재진(returning)   (정확히 365일 전 방문 = 재진, 경계 포함)
 *   diff >= 366 → 초진취급(new)      (366일 이상 경과 = 초진)
 *   무이력/파싱실패 → 초진취급(new)
 */
export function classifyVisitByRecency(
  lastCompletedVisitISO: string | null | undefined,
  todayISO: string,
): VisitType {
  if (!lastCompletedVisitISO) return 'new'; // 완료 이력 무 → 초진취급
  const diff = diffDaysISO(lastCompletedVisitISO, todayISO);
  if (Number.isNaN(diff)) return 'new';
  return diff <= RETURNING_WINDOW_DAYS ? 'returning' : 'new';
}

/**
 * 현재 클리닉(풋센터)에서 해당 고객의 최근 '완료(done)' 방문을 조회해
 * 365일 recency 로 초진/재진을 판정한다.
 *
 * - customerId 없음 → 'new'(신규 직접입력 등 식별 전).
 * - 완료방문 없음   → 'new'(초진취급).
 * - 조회 오류       → 보수적으로 'returning' 폴백(기존 '기존 고객=재진' 동작 보존, silent-fail 방지).
 *
 * best-effort: 판정 실패가 접수 동선을 막지 않도록 throw 하지 않는다.
 */
export async function resolveVisitTypeByRecency(
  customerId: string | null | undefined,
  clinicId: string | null | undefined,
): Promise<VisitType> {
  if (!customerId) return 'new';
  try {
    let q = supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('customer_id', customerId)
      .eq('status', 'done')
      .order('checked_in_at', { ascending: false })
      .limit(1);
    if (clinicId) q = q.eq('clinic_id', clinicId); // 종로 오리진점 풋센터 한정
    const { data, error } = await q;
    if (error) {
      console.warn('[visitRecency] 완료방문 조회 실패 — returning 폴백:', error.message);
      return 'returning';
    }
    const lastAt = (data?.[0]?.checked_in_at as string | undefined) ?? null;
    if (!lastAt) return 'new'; // 완료 이력 무 → 초진취급
    return classifyVisitByRecency(seoulISODate(lastAt), todaySeoulISODate());
  } catch (e) {
    console.warn('[visitRecency] 판정 예외 — returning 폴백:', e);
    return 'returning';
  }
}

/**
 * T-20260713-foot-CONSULT-AXIS-RECENCY-UNIFY
 *
 * 배치판 — 여러 고객의 초진/재진을 recency(365일)로 한 번에 판정.
 * 배정 UI(Assignments)처럼 동기 렌더에서 다수 고객 축을 파생할 때 N쿼리 대신 1~N/200 쿼리로 해결.
 *
 * ⚠ 판정 산식은 단일 헬퍼(classifyVisitByRecency) 재사용 — 접수분류/배정축/배지와 동일 소스(re-divergence 방지).
 *   본 함수는 '조회'만 배치화하고, '판정'은 resolveVisitTypeByRecency 와 완전 동일한 규칙을 따른다.
 *
 * 반환: customerId → VisitType 맵. 무이력=new / 조회실패=returning(single 헬퍼와 동일 폴백).
 * best-effort — throw 하지 않는다.
 */
export async function resolveVisitTypesByRecency(
  customerIds: (string | null | undefined)[],
  clinicId: string | null | undefined,
): Promise<Map<string, VisitType>> {
  const result = new Map<string, VisitType>();
  const ids = [...new Set(customerIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return result;

  const CHUNK = 200; // PostgREST .in() URL 길이 한계 회피(Assignments 월간 다건 대비)
  const latestAt = new Map<string, string>(); // customer_id → 최근 done checked_in_at
  const errored = new Set<string>(); // 조회 실패 id — 보수적 returning 폴백 대상
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    try {
      let q = supabase
        .from('check_ins')
        .select('customer_id, checked_in_at')
        .in('customer_id', slice)
        .eq('status', 'done')
        .order('checked_in_at', { ascending: false });
      if (clinicId) q = q.eq('clinic_id', clinicId); // 종로 오리진점 풋센터 한정
      const { data, error } = await q;
      if (error) {
        console.warn('[visitRecency] 배치 조회 실패 — 해당 chunk returning 폴백:', error.message);
        slice.forEach((id) => errored.add(id));
        continue;
      }
      // desc 정렬 → customer_id 최초 등장이 최신 완료방문
      for (const r of (data ?? []) as { customer_id: string; checked_in_at: string }[]) {
        if (!latestAt.has(r.customer_id)) latestAt.set(r.customer_id, r.checked_in_at);
      }
    } catch (e) {
      console.warn('[visitRecency] 배치 판정 예외 — 해당 chunk returning 폴백:', e);
      slice.forEach((id) => errored.add(id));
    }
  }

  const todayISO = todaySeoulISODate();
  for (const id of ids) {
    if (errored.has(id)) {
      result.set(id, 'returning'); // 조회 실패 → single 헬퍼와 동일한 보수적 폴백
      continue;
    }
    const lastAt = latestAt.get(id) ?? null;
    result.set(id, classifyVisitByRecency(lastAt ? seoulISODate(lastAt) : null, todayISO));
  }
  return result;
}
