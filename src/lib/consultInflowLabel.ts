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
 * ── T-20260731-foot-INFLOW-LABEL-TM-STAMP-GAP (확정 경로 A · DA CONSULT-REPLY MSG-20260731-163417-vvc3) ──
 *   증상: 07-14 seed 배포 이전 등록된 도파민(TM) 출처 고객(예: 조현수)은 customers.visit_route/lead_source 가
 *         둘 다 NULL 이라 상담대기 알림 [유입경로]가 '미지정'으로 오표기. B-forward seed(visit_route='TM')는
 *         이미 배포됐으나 과거 코호트는 미소급 → 라벨 갭.
 *   교정(A, ADDITIVE·no-DDL·no-backfill): 순서형 파생 규칙에 **event-provenance 폴백** 1단 추가.
 *     라벨은 여전히 단일 파생(고객 선언값 우선 → 이벤트 provenance 폴백)이지 경쟁 SSOT 2개가 아니다.
 *       returning                                         → '재진'          (최우선 유지)
 *       visit_route (비공백·非머신마커)                    → 그 값            (고객선언 우선)
 *       lead_source (비공백·"dopamine_" prefix 아님)       → 그 값            (고객선언 폴백 + 머신마커 억제)
 *       source_system == 'dopamine'                       → 'TM'            (★NEW: event-provenance 폴백)
 *       그 외                                             → '미지정'         (AC-fix6)
 *   ★머신마커 억제(§4-6-4 point 6(b) FE-suppress · point 7 foot 항목 종결): visit_route/lead_source 렌더 시
 *     `dopamine_` 네임스페이스 prefix 값(예: 'dopamine_tm')은 표시상 공백 취급 → 스태프-facing 표시-누수 봉인.
 *     오늘 foot lead_source 는 사람값만 담아 누수 0이나, 향후 §4-6-4 auto-write 활성화 시의 잠복 누수를 구조적으로 봉인.
 *
 * ── ★ RED LINE ──
 *   (AC-fix4) 본 라벨 로직은 `deriveConsultAxis`/`CONSULT_AXES`/'워크인' 폴백을 일절 변경하지 않는다.
 *     자동배정 균등 카운트·랭킹 분배는 그대로 '워크인 성격' 버킷으로 배정된다(네이버 등 별도 축 분리 금지).
 *     returning 판정만 축과 동일 규약(`=== 'returning'`)을 인라인 재사용 — 의존 무추가(순수 함수 유지).
 *   (TM-STAMP-GAP HARD) source_system 은 **배정축이 아니라 라벨의 하위 폴백 소스**일 뿐 —
 *     deriveConsultAxis/CONSULT_AXES/autoAssign **무접촉**. 또한 source_system 은 read-only 참조만
 *     (write 0, customers write 0) → Revenue Source Split SSOT(오가닉/광고) 무오염. 매출축 어휘('광고'/'오가닉')
 *     라벨 노출 금지 — 리터럴 'dopamine' 만 표시 문자열 'TM'으로 파생(개념라벨 '도파민' 아님, DB 값 기준).
 *     (resolveVisitRouteDisplay §AC-1 가드와 동일 semantic — 순수 display 매핑, 컬럼 미write.)
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
 * event-provenance 폴백 라벨 (T-20260731-foot-INFLOW-LABEL-TM-STAMP-GAP, DA 확정 A).
 * reservations.source_system 리터럴 == 'dopamine' (= 도파민이 만든 예약) 일 때만 파생. 매출축 어휘('광고') 아님.
 */
export const INFLOW_TM_LABEL = 'TM';

/**
 * 도파민 머신마커 네임스페이스 prefix. 이 prefix 로 시작하는 visit_route/lead_source 값은 스태프-facing 표시에서
 * 공백 취급(§4-6-4 point 6(b) FE-suppress). 사람이 고른 유입경로 어휘와 충돌하지 않는 예약된 네임스페이스.
 */
const DOPAMINE_MARKER_PREFIX = 'dopamine_';

/**
 * 고객선언 유입경로 값 정규화: 공백 trim + 도파민 머신마커(`dopamine_*`) 억제.
 * 머신마커면 '' 반환 → 상위 파생이 다음 폴백(다음 소스/미지정)으로 진행.
 */
function normalizeDeclaredRoute(v?: string | null): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  // 표시-누수 봉인: 'dopamine_tm' 등 머신마커는 유입경로 라벨로 노출하지 않는다(대소문자 무시 방어).
  if (s.toLowerCase().startsWith(DOPAMINE_MARKER_PREFIX)) return '';
  return s;
}

/**
 * ── T-20260818-foot-CONSULT-INFLOW-SLACK-NULL (RC: 잘못된 컬럼 참조) ──
 *   증상: 2번차트에 유입경로(=customers.first_inflow_channel canonical 11코드)가 정상 저장돼 있으나
 *         상담 배정 [확정] 슬랙 발송 메시지에서만 '미지정' 오출력.
 *   RC(택1 확정 = (a) 잘못된 컬럼/키 참조): 본 라벨 함수가 **canonical inflow 축(§36 축① =
 *         customers.first_inflow_channel, 11코드)을 참조하지 않고** legacy visit_route/lead_source 만 읽었다.
 *         INFLOW-CHANNEL-INTAKE-LANE(T-20260801) 이후 접수/예약 동선은 유입경로를 first_inflow_channel 로만
 *         적재 → visit_route/lead_source 는 신규 코호트에서 빈값 → 폴백 '미지정' 도달(조인 누락·null read 아님,
 *         매핑 실패도 아님 — 소스 컬럼 자체를 안 읽던 것). 저장값 정상, 발송 참조축만 legacy 였음.
 *   교정(display-only, no-DDL, no-write): 파생 사슬 최상위(재진 다음)에 canonical first_inflow_channel 을
 *         1단 추가 — 11코드는 표시라벨로 변환(resolveInflowLabel, system_codes/useInflowChannels SSOT).
 *         resolver 미가용(RPC 미로드)·미매핑 코드면 라벨을 만들지 않고 기존 legacy 사슬로 graceful fall-through
 *         (배포순서 무중단·무회귀). §36 방화벽: inflow 축(first_inflow_channel)만 read — referral_source/
 *         source_system/visit_route(legacy) 매핑·치환 0, 컬럼 write 0.
 */

/**
 * 상담 유입경로 표시/발송 라벨. 단일 순서형 파생
 *   (재진 → canonical inflow 11코드 → 고객선언(legacy) → 이벤트 provenance → 미지정).
 * @param consultAxis   deriveConsultAxis 결과 축('returning' 이면 유입경로 대신 '재진'). returning 판정 단일 목적.
 * @param cust          고객 원본. first_inflow_channel(canonical 11코드, 최우선) → visit_route → lead_source.
 * @param sourceSystem  이 상담 건을 만든 예약의 provenance(reservations.source_system). 'dopamine' 이면 'TM' 폴백.
 *                      read-only 참조만 — 컬럼 미write, 매출축 무오염. 미지정/누락이면 폴백 무발동.
 * @param resolveInflowLabel  canonical 11코드 → 현장 표시라벨 변환기(system_codes SSOT, useInflowChannels).
 *                      미제공/미매핑/RPC미로드면 canonical 단계를 건너뛰고 legacy 사슬로 진행(graceful, 무회귀).
 */
export function consultInflowLabel(
  consultAxis: string,
  cust:
    | { visit_route?: string | null; lead_source?: string | null; first_inflow_channel?: string | null }
    | null
    | undefined,
  sourceSystem?: string | null,
  resolveInflowLabel?: (code: string) => string | null | undefined,
): string {
  // 재진 축은 유입경로 대신 '재진'. (autoAssign.isReturningAxis 와 동일 판정 — 순수/무의존 위해 인라인)
  if (consultAxis === 'returning') return INFLOW_RETURNING_LABEL;
  // 1) ★canonical 최우선(T-20260818-SLACK-NULL fix): customers.first_inflow_channel(§36 축① 11코드) →
  //    표시라벨. resolver 미가용/미매핑이면 라벨 미생성 → 아래 legacy 사슬로 graceful fall-through(무중단·무회귀).
  const fic = (cust?.first_inflow_channel ?? '').trim();
  if (fic && resolveInflowLabel) {
    const mapped = (resolveInflowLabel(fic) ?? '').trim();
    if (mapped) return mapped;
  }
  // 2) 고객선언(legacy) 폴백: visit_route → lead_source 원문(네이버·지인소개·공홈·TM·인바운드·워크인 …). 머신마커 억제.
  const vr = normalizeDeclaredRoute(cust?.visit_route);
  if (vr) return vr;
  const ls = normalizeDeclaredRoute(cust?.lead_source);
  if (ls) return ls;
  // 3) event-provenance 폴백: 고객선언이 비었고 이 예약을 도파민(TM)이 만들었으면 'TM'.
  //    리터럴 'dopamine' 만 매핑 — NULL/manual/워크인 등 다른 값은 폴백 무발동. read-only(컬럼 미write, 매출축 무오염).
  if ((sourceSystem ?? '').trim() === 'dopamine') return INFLOW_TM_LABEL;
  // 4) 최종 폴백: 공란 노출·거짓 '워크인' 금지 → '미지정' 플레이스홀더(AC-fix6). 실제 미입력/null 케이스만 여기 도달.
  return INFLOW_UNSPECIFIED_LABEL;
}
