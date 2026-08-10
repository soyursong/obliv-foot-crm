// T-20260810-foot-COORD-STAFF-DUP-INSERT-GUARD — 활성 coordinator 중복 등록(INSERT) forward-guard 술어
//
// 배경: 부모 T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP(강다연·이진석 2중 표시)의 재발원 =
//   "동일 identity active coordinator 를 중복 staff INSERT 하는 것을 막는 가드 부재".
//   auto-sync 트리거(trg_foot_coord_autosync_registrar)는 정상 — 상류 staff 중복 INSERT 는 못 막음.
//
// canonical 다축 술어 (SSOT: agents/docs/da_replies/da_decision_foot_registrar_dup_staff_identity_dedup_20260810.md §3/§4):
//   within-clinic(clinic_id — 호출부에서 이미 스코프) + (phone[강한 축] 또는 legal_name[강한 축]).
//   ⛔ name-string 단독 = 하드 차단 금지(동명이인 오차단 방지 — DA 명시).
//
// foot staff 스키마 census (AC-1, 2026-08-10 prod READ-ONLY):
//   · staff.legal_name 컬럼 = 부재(legal_name = customers-tier 개념). → 강한 축 후보에서 제외.
//   · staff.phone 컬럼 = 존재하나 전 staff 100% null(등록폼 미캡처). → 강한 축이나 현재 값 부재.
//   ∴ foot 에서 유일 강한 축 = phone. name = display(약한 축, 차단 금지 대상).
//
// 술어 설계(false-positive 최우선):
//   1) 강한 축(phone) 일치(양측 non-empty) → 하드 차단(block). 진성 재등록만 잡힘, 동명이인은 phone 상이 → 통과.
//   2) 약한 축(name) 일치 → 경고(warn)만. 오버라이드 가능(동명이인이면 계속 등록). 자동 차단 아님 → 오차단 0.
//   호출부는 role='coordinator' AND active 인 후보에만 진입하고, 같은 clinic_id 활성 coordinator 만 비교 대상으로 전달.
//   ⇒ 재입사(비활성 레코드)·2지점 seed(다른 clinic_id)·동명이인(다른 phone) 은 구조적으로 false-block 되지 않음.

export type CoordIdentity = {
  id?: string | null;
  name?: string | null;
  phone?: string | null;
};

export type DupVerdict =
  | { kind: 'clear' }
  | { kind: 'block'; axis: 'phone'; match: CoordIdentity } // 강한 축 일치 → 하드 차단
  | { kind: 'warn'; axis: 'name'; match: CoordIdentity }; // 약한 축 일치 → 경고(오버라이드 가능)

function normPhone(p?: string | null): string {
  return (p ?? '').replace(/[^0-9]/g, '');
}

function normName(n?: string | null): string {
  // foot 이름 NFD/NFC 혼재(DA-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL) → NFC 정규화 후 trim 비교.
  return (n ?? '').normalize('NFC').trim();
}

/**
 * 활성 coordinator 중복 등록 판정.
 * @param candidate  등록하려는 coordinator (호출부에서 role='coordinator' AND active 확정 후 진입)
 * @param existingActiveCoords  같은 clinic_id 의 기존 활성 coordinator 목록(호출부에서 clinic/role/active 스코프 완료)
 */
export function evaluateCoordinatorDup(
  candidate: CoordIdentity,
  existingActiveCoords: CoordIdentity[],
): DupVerdict {
  const cPhone = normPhone(candidate.phone);
  const cName = normName(candidate.name);

  // 1) 강한 축: phone 일치(양측 non-empty) → 하드 차단
  if (cPhone) {
    const m = existingActiveCoords.find(
      (e) => e.id !== candidate.id && normPhone(e.phone).length > 0 && normPhone(e.phone) === cPhone,
    );
    if (m) return { kind: 'block', axis: 'phone', match: m };
  }

  // 2) 약한 축: name 일치 → 경고만(⛔ 하드 차단 금지 = 동명이인 오차단 방지)
  if (cName) {
    const m = existingActiveCoords.find(
      (e) => e.id !== candidate.id && normName(e.name) === cName,
    );
    if (m) return { kind: 'warn', axis: 'name', match: m };
  }

  return { kind: 'clear' };
}
