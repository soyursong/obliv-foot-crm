/**
 * T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL (DECOUPLE) — 상담 유입경로 표시/발송 라벨 SSOT.
 *
 * ── 버그(RC 확정, 가설 B) ──
 *   금일 배분 이력 화면·상담대기방(C0B4HEC9SHH) [확정] 발송 문구의 '유입경로' 라벨을
 *   자동배정 균등 버킷 파생 `deriveConsultAxis`(autoAssign.ts)로 만들었고, 이 함수는 CONSULT_AXES
 *   (TM/인바운드/워크인) 밖의 값을 전부 '워크인'으로 접는 구조적 폴백을 갖는다.
 *   → 네이버·지인소개·공홈 등 실제 유입경로가 '워크인'으로 소실(F-5294 "네이버"→"워크인" 오안내).
 *
 * ── 교정(DECOUPLE) ──
 *   표시/발송 라벨을 배정 축에서 분리해 **고객 실제 visit_route(없으면 lead_source) 원문**을 그대로 노출.
 *     · 재진(returning) 은 유입경로 대신 '재진' 표기(기존 동작 보존, RC AC-4 권장).
 *     · TM/인바운드/워크인 은 원문 그대로 = 무회귀.
 *     · ★AC-fix6: visit_route·lead_source 둘 다 빈값(null/공란)이면 '미지정' 플레이스홀더 표기.
 *       (planner MSG-9ljf(b) 명시 in-scope — 공란 노출·거짓 '워크인' 둘 다 금지. 빈 visit_route 117건 대상.)
 *       ★실값 '워크인'(라벨=원문)과 빈값 폴백을 구분: 실제 값이 '워크인'이면 '워크인' 유지, 빈값만 '미지정'.
 *
 * ── ★ RED LINE (AC-fix4) ──
 *   본 라벨 로직은 `deriveConsultAxis`/`CONSULT_AXES`/'워크인' 폴백을 일절 변경하지 않는다.
 *   자동배정 균등 카운트·랭킹 분배는 그대로 '워크인 성격' 버킷으로 배정된다(네이버 등 별도 축 분리 금지).
 *   returning 판정만 축과 동일 규약(`=== 'returning'`)을 인라인 재사용 — 의존 무추가(순수 함수 유지).
 */

/** 재진 방문의 유입경로 라벨(유입경로 대신 표기). autoAssign.deriveConsultAxis 의 'returning' 축과 대응. */
export const INFLOW_RETURNING_LABEL = '재진';
/**
 * 유입경로 원본이 빈값(null/공란)일 때의 플레이스홀더 라벨 (AC-fix6).
 * planner MSG-9ljf(b): 공란 노출·거짓 '워크인' 둘 다 금지 → '미지정' 표기.
 * (문구 자체는 field-soak 김주연 총괄 confirm 대상 / 로직=빈값 placeholder 반환은 확정.)
 */
export const INFLOW_UNSPECIFIED_LABEL = '미지정';

/**
 * 상담 유입경로 표시/발송 라벨.
 * @param consultAxis  deriveConsultAxis 결과 축('returning' 이면 유입경로 대신 '재진'). returning 판정 단일 목적.
 * @param cust         고객 원본(실제 유입경로 소스). visit_route ?? lead_source 원문을 그대로 라벨로 사용.
 */
export function consultInflowLabel(
  consultAxis: string,
  cust: { visit_route?: string | null; lead_source?: string | null } | null | undefined,
): string {
  // 재진 축은 유입경로 대신 '재진'. (autoAssign.isReturningAxis 와 동일 판정 — 순수/무의존 위해 인라인)
  if (consultAxis === 'returning') return INFLOW_RETURNING_LABEL;
  const raw = (cust?.visit_route ?? cust?.lead_source ?? '').trim();
  // 실제 유입경로 원문 노출(네이버·지인소개·공홈·TM·인바운드·워크인 …).
  // 빈값(null/공란)만 '미지정' 플레이스홀더 — 거짓 '워크인' 금지(AC-fix6). 실값 '워크인'은 위 raw 로 그대로 유지.
  return raw || INFLOW_UNSPECIFIED_LABEL;
}
