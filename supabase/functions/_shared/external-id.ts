// external-id.ts — 도파민 발신/수신 예약 external_id 파싱 공용 헬퍼 (수신부 정본 이식)
// 원본: tm-flow supabase/functions/_shared/external-id.ts
//   (T-20260615-dopamine-COMPANION-RESV-CHECKIN-FAIL)
// 이식: T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT — 풋(발톱) CRM 결제 역sync 발신부.
//   DA CONSULT-REPLY §3/§4 (+ addendum MSG-6psu): emit(crm-payment-sync-emit) 시점
//   resolveBaseCueCardId(isCompanion-aware)로 external_id→cue_card_id 1회 해소 →
//   clean UUID 직송(payload cue_card_id first-class, emit-time 조인 의존 제거).
//   §4 COMPANION 가드: isCompanion=true 는 부모 cue 오귀속 금지(companion_no_cue_attribution).
//
// 도파민 TM이 생성한 CRM 예약의 external_id 규약(crm-reservations-proxy):
//   - 본예약(메인 환자): external_id = cue_cards.id            (평문 UUID)
//   - 동행 예약        : external_id = "{cue_cards.id}_comp_{key}"
//
// ⚠️ 후방호환: 평문 UUID 입력 시 base = 원본 UUID → 동작 100% 불변.
//
// ── G1 가드(naive split 금지) ───────────────────────────────────────────────
//   split("_comp_")[0] 의 결과를 그대로 매칭키로 쓰지 않는다. anchored regex 로
//   "유효 UUID + (선택)_comp_{비어있지 않은 key}" 전체를 한 번에 검증·추출한다.
//     - "not-a-uuid_comp_x"  → 거부 (base 형식 오류)
//     - "_comp_x"            → 거부
//     - "{uuid}_comp_"       → 거부 (빈 동행 key)

const BASE_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// 전체 일치(anchored). 그룹1 = base UUID. 동행이면 뒤에 "_comp_{1+}" 만 허용.
const EXTERNAL_ID_RE = new RegExp(`^(${BASE_UUID})(?:_comp_.+)?$`, "i");

/** resolveBaseCueCardId 결과. */
export interface BaseCueCardResolution {
  /** 추출·검증 성공 여부. false 면 baseId=null (발신부는 permanent DLQ). */
  ok: boolean;
  /** 부모 cue_card_id(base UUID). ok=false 면 null. */
  baseId: string | null;
  /** 동행 external_id("{uuid}_comp_{key}") 였는지. */
  isCompanion: boolean;
}

/**
 * 공유 리졸버 — external_id → 부모 cue_card_id(base UUID).
 *
 * anchored regex 로 전체를 검증하며 base 를 추출한다. base 가 유효 UUID 가
 * 아니거나 동행 suffix 가 비면 ok=false.
 *
 * 평문 UUID → { ok:true, baseId:UUID, isCompanion:false } (후방호환).
 * "{uuid}_comp_{key}" → { ok:true, baseId:UUID, isCompanion:true }.
 */
export function resolveBaseCueCardId(externalId: unknown): BaseCueCardResolution {
  if (typeof externalId !== "string" || externalId.length === 0) {
    return { ok: false, baseId: null, isCompanion: false };
  }
  const m = EXTERNAL_ID_RE.exec(externalId);
  if (!m) return { ok: false, baseId: null, isCompanion: false };
  const baseId = m[1];
  // 전체 길이가 base 보다 길면 "_comp_{key}" suffix 가 붙은 동행.
  return { ok: true, baseId, isCompanion: externalId.length > baseId.length };
}

/** external_id 가 동행 예약 형식(`_comp_` 포함)인지. */
export function isCompanionExternalId(externalId: string): boolean {
  return externalId.includes("_comp_");
}
