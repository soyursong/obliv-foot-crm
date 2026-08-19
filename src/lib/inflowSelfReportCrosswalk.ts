/**
 * inflowSelfReportCrosswalk — 환자 셀프리포트 유입경로 → 11코드 canonical **advisory** 크로스워크
 * T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE (dev-foot)
 *
 * DA RESOLUTION(MSG-20260801-194223-aao9, 조건부 GO/ADDITIVE):
 *   · 환자 셀프리포트(키오스크/태블릿 체크리스트 referral_source) = lower-trust **candidate**.
 *   · canonical inflow_channel(11코드) 직접 write 금지 — 스태프 커밋/TM auto-stamp 전용.
 *   · 구 버튼값 → 11코드 **자동 매핑/치환 금지**(§36 Q3 방화벽 위배 NO-GO).
 *     ⇒ 본 모듈은 **비권위·참고(advisory)** 제안만 반환한다. 어떤 자동 write 도 수행하지 않는다.
 *       스태프가 셀프리포트를 참고해 **독립적으로** canonical 유입경로를 선택(커밋)하는 것이 SSOT.
 *
 * lossy 인지: 구 5~6종(coarse) ↔ 11종(fine) 은 단사(injective) 불성립. 확신 1:1 매핑이 성립하는
 *   케이스만 제안하고, 불확실(SNS/블로그/TV·언론/기타 등)은 제안 없이 스태프 직접 판단으로 남긴다.
 *   (억지 매핑은 방화벽 취지 위배 — 정보 손실·오염 전파를 advisory 층에서도 만들지 않는다.)
 */

export interface InflowCrosswalkHint {
  /** 제안 canonical 코드(§36 system_codes code_type='inflow_channel'). 비권위 참고. */
  code: string;
  /** 제안 코드의 한글 라벨. */
  label: string;
}

/**
 * 셀프리포트 원문(verbatim) → advisory 11코드 제안. 확신 1:1 만 반환, 그 외 null(스태프 직접 선택).
 * 매칭은 정규화 후 부분포함(태블릿 체크리스트 6종 + 외부 셀프체크인 변형 문구 방어).
 */
export function inflowSelfReportCrosswalk(
  selfReported: string | null | undefined,
): InflowCrosswalkHint | null {
  if (!selfReported) return null;
  const raw = selfReported.trim();
  if (!raw) return null;
  // 정규화: 소문자 + 공백/구분자(·/_-) 제거 → 표기 흔들림 흡수.
  const norm = raw.toLowerCase().replace(/[\s·/_\-.]/g, '');

  // 확신 1:1 매핑만(lossy-aware) — 어느 것에도 안 걸리면 null(스태프 직접 판단).
  //  · '네이버 검색' / '검색_네이버' → inbound.naver_place(네이버)
  if (norm.includes('네이버') || norm.includes('naver')) {
    return { code: 'inbound.naver_place', label: '네이버' };
  }
  //  · '카카오톡' / '카톡' / '카카오' / 'kakao' → inbound.kakao(카톡)
  //    T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD: 카카오톡 = 진성 canonical 1급 inbound 채널(system_codes inbound.kakao).
  //    셀프리포트에 카카오톡 표기가 명확하면 확신 1:1 → advisory 제안(비권위·자동 write 0, 스태프가 데스크에서 확정).
  if (norm.includes('카카오') || norm.includes('카톡') || norm.includes('kakao')) {
    return { code: 'inbound.kakao', label: '카톡' };
  }
  //  · '지인 소개' / '지인소개_{성함}' → inbound.referral(지인 소개)
  if (norm.includes('지인') || norm.includes('소개')) {
    return { code: 'inbound.referral', label: '지인 소개' };
  }
  // SNS/인스타·블로그·TV/언론·제휴·기타 등 = 확신 1:1 부재 → 제안 없음(스태프 직접 선택).
  return null;
}
