/**
 * registrarMatch — 예약등록자(registrar_name) 정규화·매칭 SSOT (풋)
 *
 * T-20260728-foot-RESV-DOPATM-BADGE-NAMEONLY-MYFILTER:
 *   body T-20260728-body-RESV-MYONLY-DOPAMINE-REGISTRANT(deployed d440316e)의
 *   creatorName.ts registrantMatchKey / isSameRegistrant 하드닝 패턴을 풋 구조로 이식.
 *
 *   ★ body 와 저장구조가 다르다(맹목 미러 금지):
 *     - body: 도파민-origin 예약 = created_by=NULL(§963⑥) + source_registrant_name=상담사명.
 *     - foot: 도파민-origin 예약 = registrar_name 에 저장.
 *         · EF 매칭(reservation_registrars TM group) → registrar_id(FK) + clean 스냅샷 name.
 *         · 무매칭 → registrar_id=NULL + registrar_name='[도파민TM] {name}' provenance 라벨.
 *   따라서 풋의 '내 예약' 필터 RC = created_by 가 아니라 registrar_name 의 '[도파민TM] ' prefix 로
 *   NAME-MATCH(registrar_name === 로그인 표시명)가 깨져 도파민-origin 본인 예약이 누락되는 것.
 *
 *   ★ 계승한 body 하드닝(AC-1 필수):
 *     - .normalize('NFC') (body d440316e: 도파민 push payload NFD 운반 이력 대비 under-match 방지)
 *     - prefix strip 후 clean 키 비교(exact-match on prefixed form 금지, AC-1/AC-4)
 *     - 매칭키 null/opaque(UUID·긴 무공백 토큰)이면 false 폴백
 *       (남의 도파민 예약 무차별 '내것' 흡수 금지 = P0 privacy leak 방지, body AC-6 계승)
 *
 *   ★ DISPLAY-SCOPING 전용·승격 금지 (body §963⑫ addendum 계승):
 *     이 이름-매칭 술어는 '내 예약' 개인 뷰의 편의 display-scoping 일 뿐 —
 *     ownership/attribution/access-control 판정이 아니다. registrar_name 은 read-only 소비,
 *     created_by / registrar_id / source_system write 0 (§416/§963⑥ 무위반, no-DDL).
 *   ★ 동명이인 오매칭 = P2 bounded mis-attribution (P0 disclosure 아님):
 *     예약관리 격자는 등록자-RLS 스코프 아님(clinic_id+date only) → '내 예약' OFF 면 이미 가시.
 */

/** UUID v4 형태 판별 (이름 문자열이 아닌 opaque id 차단) */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** opaque id 판별 — 공백 없는 32자 이상 토큰(UUID·auth id·raw fallback). 사람 이름은 미해당. */
const OPAQUE_ID_RE = /^[0-9A-Za-z_.:-]{32,}$/;

/**
 * 도파민 provenance prefix — EF(reservation-ingest-from-dopamine)가 무매칭 시 착지한
 * '[도파민TM] {name}' 라벨. 공백/브래킷 변형('[ 도파민 TM ]', '[도파민 TM]')도 방어적으로 흡수.
 */
export const DOPAMINE_TM_PREFIX_RE = /^\s*\[\s*도파민\s*TM\s*\]\s*/;

/**
 * registrar_name 을 clean 이름으로 정규화(prefix strip + NFC + trim).
 * @returns clean 이름(실제 길이 보존) | null(공란·UUID·opaque id → 매칭 불가)
 */
export function cleanRegistrantName(raw: string | null | undefined): string | null {
  const stripped = (raw ?? '').replace(DOPAMINE_TM_PREFIX_RE, '').trim();
  if (!stripped) return null; // 공란
  if (UUID_RE.test(stripped)) return null; // UUID
  if (OPAQUE_ID_RE.test(stripped)) return null; // 긴 opaque id
  return stripped.normalize('NFC'); // body d440316e: NFD↔NFC under-match 방지
}

/**
 * 예약등록자 표시명을 정규화 매칭 키로 환원(prefix strip + NFC + 내부공백 축약).
 * @returns clean 매칭 키 | null(공란·UUID·opaque id → 매칭 불가)
 */
export function registrantMatchKey(raw: string | null | undefined): string | null {
  const clean = cleanRegistrantName(raw);
  if (!clean) return null;
  return clean.replace(/\s+/g, ' '); // 다중공백 표기 변형 방어
}

/**
 * 두 표시명이 동일 등록자인지(정규화 clean 키 exact-match).
 * 한쪽이라도 폴백(null=공란/UUID/opaque)이면 오매칭 방지 위해 false.
 */
export function isSameRegistrar(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = registrantMatchKey(a);
  const kb = registrantMatchKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/**
 * AC-1: '내 예약' 필터 판정 — 예약등록자가 대상(로그인 표시명/선택 담당자)인지.
 *   경로1 (회귀 유지): registrar_name 원문 exact trim 매칭
 *     — native(풋 자체)·EF 매칭 도파민(clean 스냅샷)·기존 동명이인 수용 동작 불변.
 *   경로2 (gap 보강, DA §963⑫ ① origin-gate): source_system='dopamine' 구조 파티션 한정으로
 *     '[도파민TM] {name}' prefix 잔존분 → 양측 clean 키(NFC) 매칭.
 *     — created_by=NULL-equiv(풋에선 prefix로 NAME-MATCH 깨짐) 도파민-origin 본인 예약 포함.
 *     — native 예약은 경로2 미진입(source_system≠dopamine) → exact 경로만 = 회귀 0.
 *   ★ DA §963⑫ 5-AC 바인딩: ①origin-gate(source_system='dopamine' 한정) ②정규화 SSOT 재사용
 *     ③null/UUID/opaque false-폴백 ④display-scoping 전용·attribution/ownership/access 비승격
 *     ⑤보드 non-RLS 전제(예약관리 격자=clinic_id+date, 등록자-RLS 아님 → 동명이인=bounded
 *       mis-attribution P2, disclosure 아님). RLS 격자였다면 fail-closed(supervisor 배포전 게이트).
 * @param registrarName reservations.registrar_name (read-only)
 * @param mineTarget    로그인 표시명 또는 선택 담당자명
 * @param sourceSystem  reservations.source_system (경로2 origin-gate)
 */
export function isMineRegistrar(
  registrarName: string | null | undefined,
  mineTarget: string | null | undefined,
  sourceSystem?: string | null | undefined,
): boolean {
  const target = (mineTarget ?? '').trim();
  if (!target) return false; // 빈 표시명 → 매칭 불가(무차별 흡수 방지)
  // 경로1: 기존 exact match (회귀 0)
  if ((registrarName ?? '').trim() === target) return true;
  // 경로2: dopamine-origin 파티션 한정 prefix-strip clean 키 매칭 (NFC·opaque fallback → false)
  if ((sourceSystem ?? '').trim() !== 'dopamine') return false; // origin-gate
  return isSameRegistrar(registrarName, target);
}
