/**
 * reservation-ingest-from-dopamine — TA2 v2
 * 도파민 → 풋CRM Forward 수신부
 *
 * 도파민 TM이 예약 확정 후 Push할 때 풋이 받는 EF.
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-1, §6-1, §5, §7
 *
 * ── v2 변경점 ────────────────────────────────────────────────────
 *   결함 3 재강화: FOOT_CLINIC_ID env var → clinic_slug→clinics.id DB 조회
 *   clinic_slug 필수 필드 승격
 *   clinic not found → 422 CLINIC_NOT_FOUND
 *
 * ── Auth ────────────────────────────────────────────────────────
 *   헤더: X-Callback-Secret: <DOPAMINE_CALLBACK_SECRET>
 *   불일치 시 401, 처리 없음
 *
 * ── Request Body (§6-1) ─────────────────────────────────────────
 *   {
 *     "source_system": "dopamine",
 *     "external_id": "<cue_card_id UUID 또는 동행 composite `{cue_card}#companion-N` text>",
 *     "is_companion": false,                ← optional. true=동행(§444 명시 boolean only). T-20260630-COMPANION
 *     "clinic_slug": "jongno-foot",         ← 필수 (DB 조회용, {지점}-{도메인} 통일표기)
 *     "customer": {
 *       "phone_e164": "+82102345...",      ← 비동행 필수. 동행(is_companion=true)은 무폰 수용(optional)
 *       "name": "홍길동",
 *       "customer_real_name": "동행루루",   ← optional. 동행명/본명 스냅샷(§4-2b 비키). 미동봉 시 동행은 name 폴백
 *       "gender": "F"            // optional. (birth_year 는 DA (C)DROP — 수신/적재하지 않음)
 *     },
 *     "reservation": {
 *       "scheduled_at": "2026-05-25T14:30:00+09:00",
 *       "slot_type": "new_consult",
 *       "service_code": "FC-PDL-01",          ← optional. 발톱/풋 service 태깅 (services.service_code)
 *       "memo": "도파민 TM 상담 메모",
 *       "brief_note": "발톱무좀",               ← optional. 간략메모(문제성발톱 등) → reservations.brief_note (T-20260708-NAILPROB-SUBFILTER-PUSH)
 *       "registrar_name": "김상담",            ← optional. 로그인 TM 표시 라벨(provenance 표시축)
 *       "visit_route": "TM",                   ← optional. 방문경로(父 tier-1 push는 항상 'TM')
 *       "campaign_id": "...",
 *       "adset_id": "...",
 *       "ad_id": "..."
 *     }
 *   }
 *
 * ── registrar_name / visit_route 착지 (T-20260630-foot-INGEST-REGISTRAR-CREATEDBY) ──
 *   RECONCILE-FINAL(DA-20260630-RESV-REGISTRAR-RECONCILE-FINAL §416 governing):
 *   (a) created_via='dopamine' same write-path (旣존, 회귀 확인).
 *   (b) registrar_name → reservation_registrars(group_name='TM'·clinic·active) name 조회 →
 *       매칭 시 registrar_id(FK)+name 스냅샷, 무매칭 → registrar_id=NULL + '[도파민TM] {name}' 라벨.
 *       ⛔ 방화벽: 표시 전용 — created_by/stats/인센티브 산식 절대 미승격. email/staff_id 매칭 금지(컬럼 부재).
 *   (c) created_by = NULL graceful 유지(registrar→created_by 착지 WITHDRAWN, §416 이중계상).
 *   (KEEP) visit_route='TM'(旣존 enum) — source_system='dopamine'과 직교 독립 set.
 *
 * ── customers.visit_route seed (T-20260714-foot-RESVROUTE-CUSTOMERS-SYNC-FIX) ──
 *   reservations.visit_route='TM' 착지에 더해 customers.visit_route(2번차트 방문경로)도 연동.
 *   RC: 초진(new_consult) 다수가 이 TM 인입인데 customers.visit_route 미seed → 2번차트 방문경로 공란
 *       (prod Phase0 실측 dopamine 59/60 NULL). FE 게이트 제거(ALWAYSYNC)는 TM 초진에 무효(이 EF 경로는 FE 미경유).
 *   계약: 신규고객 INSERT = visitRouteLanded seed / 기존고객 = preserve-on-NULL fill(non-empty 수동값 미터치, no-clobber).
 *   G1: visit_route 단일 컬럼만 / G3: source_system 무접촉(매출 split 불변).
 *
 * ── service_id 태깅 (T-20260627-foot-INGEST-SERVICE-TAG / B-9) ────
 *   reservation.service_code (도파민이 운반한 발톱 product 코드, 예: FC006/FC007 류)
 *   → services.service_code DB 조회(clinic 스코프) → reservations.service_id 착지.
 *   OPTIONAL·best-effort: 필드 미존재 시 종전대로 service_id NULL(비-발톱 회귀 0).
 *   코드 미매칭 시 ingest 실패 아님 — 경고 로그 + service_id NULL (FK 위반 500 방지).
 *
 * ── Response ────────────────────────────────────────────────────
 *   200 정상:       { ok: true, reservation_id: "<uuid>", applied: true }
 *   200 중복:       { ok: true, reservation_id: "<uuid>", applied: false, reason: "duplicate" }
 *   400 스키마:     { ok: false, error: "INVALID_BODY" | "MISSING_FIELD", detail: string }
 *   401 인증:       { ok: false, error: "UNAUTHORIZED" }
 *   422 클리닉 없음: { ok: false, error: "CLINIC_NOT_FOUND", reason: string }
 *   500 내부:       { ok: false, error: "INTERNAL", detail: string }
 *
 * ── 멱등성 ──────────────────────────────────────────────────────
 *   UNIQUE(source_system, external_id) partial index on reservations
 *   중복 시 기존 reservation_id 반환 (200 applied:false)
 *
 * ── 클리닉 ID ────────────────────────────────────────────────────
 *   clinic_slug (payload) → clinics 테이블 DB 조회 → clinic.id
 *   slug 미매칭 시 422 CLINIC_NOT_FOUND
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-callback-secret',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

// T-20260702-dopamine-FOOTRESV-MEMO-REPROBE: 도파민 예약메모를 SoT(reservation_memo_history=rmh)에 정렬.
//   근본원인(런타임 규명): 본 ingest EF 가 실제 push 경로임에도 memo 를 reservations.memo
//   (deprecated[T-20260504-MEMO-RESTRUCTURE], FE 미read)에만 직접 착지시켜, 풋 예약상세 팝업>예약메모
//   및 달력 hover(둘 다 rmh 를 read)에서 공란이었다. 재타겟 RPC(upsert_reservation_from_source,55f3f62d)는
//   rmh 에 쓰지만 이 경로에서 미호출(직접 insert) → 7/1 02:00 RPC 재타겟이 실 push 에 무효과였음.
//   해소: DA-20260701-FOOTRESV-MEMO-SOT-RETARGET ruling(예약메모 SoT=rmh, timeline-only,
//   source_system provenance, 멱등 upsert)을 이 EF 에도 동일 적용. 스키마 무변경 —
//   source_system 컬럼·uq_rmh_resv_source partial unique 인덱스는 마이그 20260701020000 旣존.
async function syncReservationMemoToTimeline(
  // deno check: createClient 반환 제네릭이 호출부 admin 추론형과 불일치 → EF helper 는 loose 타입.
  // deno-lint-ignore no-explicit-any
  admin: any,
  reservationId: string,
  clinicId: string,
  rawMemo: string | undefined,
  sourceSystem: string,
): Promise<void> {
  const content = (rawMemo ?? '').trim();
  // 빈값 skip(멱등 no-op): 사람 저작행(source_system NULL)·기존 외부 memo 보존.
  if (!content) return;

  // uq_rmh_resv_source = PARTIAL unique index (WHERE source_system IS NOT NULL).
  //   supabase-js .upsert({onConflict}) 는 partial index 술어(WHERE)를 못 실어 42P10 → 사용 불가.
  //   대신 명시적 select→update|insert(멱등). 동일 (reservation_id, source_system) 재push=content UPDATE
  //   — RPC 55f3f62d 의 ON CONFLICT DO UPDATE 와 동일 결과. race(23505) 시 update 폴백.
  const { data: existingMemo } = await admin
    .from('reservation_memo_history')
    .select('id')
    .eq('reservation_id', reservationId)
    .eq('source_system', sourceSystem)
    .maybeSingle();

  if (existingMemo) {
    const { error } = await admin
      .from('reservation_memo_history')
      .update({ content })
      .eq('id', existingMemo.id);
    if (error) console.error(`[reservation-ingest] memo timeline update failed rid=${reservationId}: ${error.message}`);
    return;
  }

  const { error } = await admin
    .from('reservation_memo_history')
    .insert({
      reservation_id: reservationId,
      clinic_id: clinicId,             // ★ RLS rmh_clinic_access 가시성(RPC 라인과 동일 critical)
      content,
      created_by_name: '도파민TM',      // RPC 55f3f62d 와 동일 provenance 라벨
      source_system: sourceSystem,     // NULL=사람저작 / 외부=sync (uq_rmh_resv_source 대상)
    });
  if (error) {
    // race: 동시 push 로 partial-unique 위반(23505) → update 폴백.
    if ((error as { code?: string }).code === '23505') {
      const { data: raceMemo } = await admin
        .from('reservation_memo_history')
        .select('id')
        .eq('reservation_id', reservationId)
        .eq('source_system', sourceSystem)
        .maybeSingle();
      if (raceMemo) {
        await admin.from('reservation_memo_history').update({ content }).eq('id', raceMemo.id);
        return;
      }
    }
    // 예약행은 이미 생성됨(주 artifact) → 메모 sync 실패로 ingest 500 로 되돌리지 않고 경고만.
    console.error(`[reservation-ingest] memo timeline insert failed rid=${reservationId}: ${error.message}`);
  }
}

// E.164 phone validation (+[country][number], 7-15 digits after +)
function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

// ── T-20260723-foot-COMPANION-REALPHONE-RESVPOPUP-DROP: 동행 실연락처 폴백 파생기 ──
//   [진원] 동행 push(external_id `<parent>_comp_<phone_e164>`)가 companion_phone 필드를
//          어느 키에도 동봉하지 않음 → reservations.customer_real_phone NULL 착지 → 예약상세 팝업
//          '동행자 연락처' 공란. 그러나 동행 실연락처는 composite external_id 접미사(`_comp_<phone>`)에
//          결정적으로 실려 풋CRM 에 이미 도착·저장됨(실측 확증). ⇒ payload 필드 소진 시 external_id 에서 파생.
//   [안전] 동행(is_companion)에서만·표시전용(customer_real_phone landing)·identity 무접촉:
//          external_id 는 이미 저장된 값 → PII 표면 증가 0. 엄격 phone 패턴(선택 '+' + 8~15 digits)만
//          수용 → 이름/토큰 오탐 0. phone_e164/customer_phone/provision 경로 미투입(§461 collapse 무관, 비키·INV-3).
function companionPhoneFromExternalId(extId: string | undefined): string | undefined {
  if (!extId) return undefined;
  const marker = '_comp_';
  const idx = extId.lastIndexOf(marker);
  if (idx < 0) return undefined;
  const suffix = extId.slice(idx + marker.length).trim();
  return /^\+?\d{8,15}$/.test(suffix) ? suffix : undefined;
}

// ── T-20260719-foot-DOPAMINE-RESCHED-INGEST-5XX-DIAG: scheduled_at 경계 캐스팅 방어 검증기 ──
//   도파민 reschedule('날짜 변경') push 가 date-only/malformed scheduled_at 을 운반할 때
//   substring 파생 date/time 이 비-DATE/비-TIME → RPC 인자(p_reservation_date DATE / p_reservation_time
//   TIME) PostgREST 경계 캐스팅(22007 'invalid input syntax') hard-fail → RPC 미실행 → 500 을 유발.
//   valid 여부를 선판정해 malformed 이면 existing 행의 known-good 값으로 폴백(호출부).
function isValidDate(s: string | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isValidTime(s: string | undefined): boolean {
  return !!s && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

// ── Cross-CRM slug 통일 (dual-key transition window, ~2026-06-15 구키 제거) ──────
//   도파민 신키 'jongno-foot' ↔ 구키 'foot-jongno' 1주 전환기 양쪽 수용.
//   입력 slug는 구키→신키 정규화 후 clinics.slug DB 조회 (in-flight 구키 메시지 보호).
//   paired: T-20260602-dopamine-CLINIC-SLUG-UNIFY
const SLUG_ALIAS: Record<string, string> = {
  'foot-jongno': 'jongno-foot',
};
function normalizeSlug(slug: string): string {
  return SLUG_ALIAS[slug] ?? slug;
}

// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // ── AC-2: X-Callback-Secret 인증 ──────────────────────────────────────────
  const expectedSecret = Deno.env.get('DOPAMINE_CALLBACK_SECRET') ?? '';
  const receivedSecret = req.headers.get('X-Callback-Secret') ?? '';
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn('[reservation-ingest] 401 — secret mismatch');
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── AC-3: Payload 파싱 ───────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'INVALID_BODY', detail: 'JSON parse failed' }, 400);
  }

  // 필수 최상위 필드
  const sourceSystem = body['source_system'] as string | undefined;
  const externalId   = body['external_id']   as string | undefined;
  const clinicSlug   = body['clinic_slug']   as string | undefined;
  const customer     = body['customer']       as Record<string, unknown> | undefined;
  const reservation  = body['reservation']   as Record<string, unknown> | undefined;

  if (!externalId) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'external_id required' }, 400);
  }
  // v2: clinic_slug 필수 승격 (DB 조회 기반으로 전환)
  if (!clinicSlug) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'clinic_slug required' }, 400);
  }
  if (!customer || typeof customer !== 'object') {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'customer object required' }, 400);
  }
  if (!reservation || typeof reservation !== 'object') {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'reservation object required' }, 400);
  }

  // ── 동행(companion) discriminator (T-20260630-foot-COMPANION-RESV-INSERT-FAIL, §444) ──
  //   ★ 명시 boolean only — 더미폰 토큰/이름유무 등 보조신호 판정 절대 금지(§444 국가코드 whack-a-mole 차단).
  //   true → customers 링크 skip(customer_id=NULL, §52) + customer_real_name(동행명) 스냅샷 + 무폰 수용.
  //   미동봉/false → 기존 비동행 경로 100% 불변(0-회귀). composite external_id(text)는 external_id TEXT 전환으로 수용.
  const isCompanion =
    body['is_companion'] === true ||
    (!!customer && customer['is_companion'] === true) ||
    (!!reservation && reservation['is_companion'] === true);

  // customer 필수 필드
  const phoneE164 = customer['phone_e164'] as string | undefined;
  // ── T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL AC-2 (ingest NFC 가드, ADDITIVE, defense-in-depth) ──
  //   [진원] 도파민 push payload 가 한글 이름을 유니코드 NFD(자모분해)로 운반 → 가드 없이 customers.name/
  //          reservations.customer_name 에 raw 적재 → 이름검색·dedup 실패(LIKE '%강승은%'=0). 백필로 기존분 정정,
  //          본 가드로 재유입 차단. 근원(도파민 write-path)은 별건 T-20260721-dopamine-PUSH-PAYLOAD-NAME-NFC-NORMALIZE-GUARD.
  //   [계약] persist 前 경계에서 NFC 정규화(값-보존·멱등). 완성형 입력은 no-op, NFD 입력만 교정.
  //          아래 모든 landing(customers INSERT/fill, reservations.customer_name/customer_real_name)이 이 정규화값을 사용.
  const nameRaw   = customer['name']       as string | undefined;
  const name      = typeof nameRaw === 'string' ? nameRaw.normalize('NFC') : nameRaw;
  // 동행명 스냅샷(§4-2b 비키): 명시 customer_real_name 우선 → 동행이면 name 폴백. (동일 NFC 가드)
  const customerRealNameInRaw = customer['customer_real_name'] as string | undefined;
  const customerRealNameIn = typeof customerRealNameInRaw === 'string' ? customerRealNameInRaw.normalize('NFC') : customerRealNameInRaw;
  // T-20260721-foot-COMPANION-PHONE-EXPOSE: 동행 본인 실 연락처 스냅샷(§4-2b 비키·표시전용, INV-3).
  //   표준 필드 customer_real_phone 우선 → companion_phone 별칭(도파민 emit 명칭 변형) 폴백. 셋 다 opaque 표시축.
  //   ★ phone_e164(동행 identity 토큰=DUMMY/공유폰)로는 절대 폴백 금지 — 표시전용 실연락처만 착지(§461 collapse 재도입 차단).
  //   T-20260723-foot-COMPANION-REALPHONE-RESVPOPUP-DROP: payload 필드 3소진(undefined/공백) 시
  //   동행 composite external_id 접미사(`_comp_<phone>`)에서 실연락처 파생(표시전용 폴백). 동행에서만.
  const customerRealPhoneFromPayload =
    (customer['customer_real_phone'] as string | undefined) ??
    (customer['companion_phone'] as string | undefined) ??
    (reservation['companion_phone'] as string | undefined) ??
    (body['companion_phone'] as string | undefined);
  const customerRealPhoneIn =
    (typeof customerRealPhoneFromPayload === 'string' && customerRealPhoneFromPayload.trim() !== '')
      ? customerRealPhoneFromPayload
      : (isCompanion ? companionPhoneFromExternalId(externalId) : undefined);

  // 이름은 동행 포함 필수(표시명 복원 근거).
  if (!name) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'customer.name required' }, 400);
  }
  // 비동행만 phone_e164 필수 + E.164 검증. 동행(§444)은 무폰 수용.
  if (!isCompanion) {
    if (!phoneE164) {
      return json({ ok: false, error: 'MISSING_FIELD', detail: 'customer.phone_e164 required (non-companion)' }, 400);
    }
    // AC-4: E.164 포맷 검증
    if (!isE164(phoneE164)) {
      return json({ ok: false, error: 'MISSING_FIELD', detail: `customer.phone_e164 '${phoneE164}' is not valid E.164` }, 400);
    }
  }

  // reservation 필수 필드
  const scheduledAt = reservation['scheduled_at'] as string | undefined;
  if (!scheduledAt) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'reservation.scheduled_at required' }, 400);
  }

  // ── 선택 필드 추출 ─────────────────────────────────────────────────────────
  const gender            = customer['gender']             as string | undefined;
  // T-20260630-foot-DOPAMINE-INGEST-BIRTHYEAR: birth_year = 비-SSOT (DA CONSULT-REPLY (C)DROP).
  //   birth_year 는 cue_cards.age 역산 추정치(lossy ±1y)일 뿐 '생년' SSOT 아님. foot customers 의
  //   생년 SSOT = birth_date(RRN 앞6자리 서버파생, 대표원장 컨펌). emit-side(dopamine push EF)가
  //   birth_year emit-stop. ingest 는 키 동봉되더라도 무조건 무시(미추출·미적재) = (C)DROP "foot ingest 무시".
  //   (이전 fail-fast 회귀 차단: customers.birth_year 컬럼 부재로 키 동봉 시 'column not found' 502 재발 방지.)
  // T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK: consent_marketing = 비-SSOT divergent 명칭
  //   (DA NO-GO as-named). 컬럼 DROP + 코드참조 동반 제거(가드B). 광고동의 canonical 거처=consent_ad.
  const slotType          = reservation['slot_type']       as string | undefined;
  const serviceCode       = reservation['service_code']    as string | undefined;
  const memo              = reservation['memo']            as string | undefined;
  // T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL (FIX/reopen): 취소요청 discriminator.
  //   도파민 foot-reservation-push 는 cancel 일 때만 reservation.status='cancelled' 동봉(그 외/누락=active).
  //   기존 external_id 에 대해 이 값이 'cancelled' 면 EF 가 duplicate 단락 대신 RPC 취소 fast-path 로 라우팅.
  const statusIn          = reservation['status']          as string | undefined;
  const campaignId        = reservation['campaign_id']     as string | undefined;
  const adsetId           = reservation['adset_id']        as string | undefined;
  const adId              = reservation['ad_id']           as string | undefined;
  // T-20260630-foot-INGEST-REGISTRAR-CREATEDBY (RECONCILE-FINAL §RE-SCOPE):
  //   registrar_name = 도파민이 운반한 로그인 TM 표시 라벨(provenance 표시축). reservation 블록 동봉.
  //   visit_route    = 방문경로(父 tier-1 push는 항상 'TM'). source_system='dopamine'과 직교 독립 set.
  //   ⛔ registrar_email/created_by 착지는 WITHDRAWN(§416 이중계상) — 수신/해소하지 않는다.
  const registrarName     = reservation['registrar_name']  as string | undefined;
  const visitRoute        = reservation['visit_route']     as string | undefined;
  // T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH: 간략메모(문제성발톱=발톱무좀/내성발톱 등).
  //   도파민 CTI가 문제성발톱 선택 시 reservation.brief_note 로 운반(commit 66d661d).
  //   → reservations.brief_note(旣존 컬럼, FE 예약상세 팝업>간략메모 read SoT) 착지.
  //   신규 INSERT 경로(rsvPayload) + edit/reschedule RPC 경로(p_brief_note) 양쪽 배선.
  //   빈값/미동봉 → 미삽입·NULL(회귀 0). 예약메모(rmh timeline)와 직교 독립 축.
  const briefNote         = reservation['brief_note']      as string | undefined;

  // ── Supabase service role client ──────────────────────────────────────────
  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin        = createClient(supabaseUrl, serviceKey);

  try {
    // ── 결함 3 강화: clinic_slug → clinics.id DB 조회 ─────────────────────────
    // v2: FOOT_CLINIC_ID env var 의존 제거 — DB에서 직접 slug→id 매핑
    // dual-key: 구키('foot-jongno') 수신 시 신키('jongno-foot')로 정규화 후 조회
    const lookupSlug = normalizeSlug(clinicSlug);
    const { data: clinicRow, error: clinicLookupErr } = await admin
      .from('clinics')
      .select('id')
      .eq('slug', lookupSlug)
      .maybeSingle();

    if (clinicLookupErr) {
      console.error('[reservation-ingest] clinic lookup DB error:', clinicLookupErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `clinic lookup failed: ${clinicLookupErr.message}` }, 500);
    }
    if (!clinicRow) {
      console.warn(`[reservation-ingest] 422 — clinic_slug '${clinicSlug}' not found in clinics table`);
      return json({ ok: false, error: 'CLINIC_NOT_FOUND', reason: `clinic_slug '${clinicSlug}' not found` }, 422);
    }
    const clinicId = clinicRow.id as string;

    // ── B-9 (T-20260627-foot-INGEST-SERVICE-TAG): service_code → service_id ──────
    //   도파민이 운반한 발톱 product 코드(reservation.service_code, 예: FC006/FC007 류)를
    //   풋 service 카탈로그(services.service_code, clinic 스코프)로 해석해 service_id 확보.
    //   설계 원칙(회귀 0 우선):
    //     - service_code 미존재 → 종전 동작(service_id NULL). 비-발톱/워크인 회귀 0.
    //     - 코드 미매칭/조회에러 → ingest 실패 아님(best-effort). 경고 로그 후 NULL.
    //       (services.id를 직접 받지 않고 DB 조회로만 채워 FK 위반 500 경로를 원천 차단.)
    let serviceId: string | null = null;
    if (serviceCode && typeof serviceCode === 'string' && serviceCode.trim() !== '') {
      const { data: svcRow, error: svcLookupErr } = await admin
        .from('services')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('service_code', serviceCode.trim())
        .maybeSingle();
      if (svcLookupErr) {
        console.warn(`[reservation-ingest] service_code '${serviceCode}' lookup error (non-fatal): ${svcLookupErr.message} — service_id NULL`);
      } else if (!svcRow) {
        console.warn(`[reservation-ingest] service_code '${serviceCode}' not found in services (clinic ${clinicId}) — service_id NULL`);
      } else {
        serviceId = svcRow.id as string;
      }
    }

    // ── (b) registrar_name provenance 표시 (RECONCILE-FINAL AC2 / §RE-SCOPE) ───────
    //   도파민이 운반한 registrar_name(로그인 TM 표시 라벨)을 풋 예약등록자 마스터로 해석.
    //   ⛔ 방화벽(§416, 필수): registrar_id/registrar_name 은 순수 표시축 — created_by·
    //      stats·집계·인센티브 산식으로 절대 승격하지 않는다(이중계상 방지의 핵심 격리).
    //   ⚠ 매칭키 = name 뿐 — reservation_registrars 엔 email/staff_id 컬럼 부재(DA 정정-1).
    //   해소 규칙(best-effort 표시축, ingest 비차단):
    //     - reservation_registrars(clinic·group_name='TM'·active) name 매칭
    //         → registrar_id(FK) + registrar_name(마스터 스냅샷) 착지
    //     - 무매칭/조회에러 → registrar_id=NULL + registrar_name='[도파민TM] {name}' provenance 라벨 TEXT
    //     - registrar_name 미수신 → 두 컬럼 미삽입(NULL 유지, 회귀 0)
    let registrarId: string | null = null;
    let registrarNameLanded: string | null = null;
    if (registrarName && typeof registrarName === 'string' && registrarName.trim() !== '') {
      const rn = registrarName.trim();
      // .limit(1)+배열 수신: 동일 name 다중행(마스터에 UNIQUE 없음) 시 maybeSingle throw 회피.
      const { data: regRows, error: regLookupErr } = await admin
        .from('reservation_registrars')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .eq('group_name', 'TM')
        .eq('active', true)
        .eq('name', rn)
        .order('sort_order', { ascending: true })
        .limit(1);
      const regRow = regRows && regRows.length > 0 ? regRows[0] : null;
      if (regLookupErr) {
        console.warn(`[reservation-ingest] registrar lookup error (non-fatal): ${regLookupErr.message} — provenance label fallback`);
        registrarId = null;
        registrarNameLanded = `[도파민TM] ${rn}`;
      } else if (regRow) {
        registrarId = regRow.id as string;
        registrarNameLanded = (regRow.name as string) ?? rn;   // 마스터 리네임/삭제 대비 스냅샷
      } else {
        // 무매칭 → provenance 라벨(표시 전용, FK 미착지)
        registrarId = null;
        registrarNameLanded = `[도파민TM] ${rn}`;
      }
    }

    // ── (KEEP) visit_route='TM' tier-1 (RECONCILE-FINAL AC3) ──────────────────────
    //   수신 visit_route(父 tier-1 push는 항상 'TM')를 旣존 CHECK enum 검증 후 착지.
    //   source_system='dopamine'과 직교 독립 set(서로 파생 금지). 비-enum 값/미수신 → 미삽입(회귀 0).
    const VISIT_ROUTE_ENUM = ['TM', '워크인', '인바운드', '지인소개'];
    const visitRouteLanded = (visitRoute && VISIT_ROUTE_ENUM.includes(visitRoute)) ? visitRoute : null;

    // ── created_via / customer_real_name / visit_type 선산출 (INSERT 경로 + edit/cancel RPC 라우팅 공용) ──
    //   T-20260628-crm-RESV-CREATED-VIA-FILL §2: canonical enum v1.1 정합. source_system 채널 →
    //   created_via 정합 매핑, 미지/기본=dopamine(본 EF=도파민 인입 경로). ★별칭 금지(admin/phone/walk-in).
    const CREATED_VIA_BY_SOURCE: Record<string, string> = {
      dopamine: 'dopamine', aicc: 'aicc', naver: 'naver',
      meta: 'meta', kakao: 'kakao', inbound: 'inbound',
    };
    const createdVia = CREATED_VIA_BY_SOURCE[(sourceSystem ?? 'dopamine').toLowerCase()] ?? 'dopamine';
    // 동행명/본명 스냅샷 (§4-2b 비키): 명시 customer_real_name 우선 → 동행이면 name 폴백. 비동행 미동봉 → undefined(0-회귀).
    const customerRealName =
      (customerRealNameIn && customerRealNameIn.trim() !== '')
        ? customerRealNameIn.trim()
        : (isCompanion ? name : undefined);
    // T-20260721-foot-COMPANION-PHONE-EXPOSE: 동행 실연락처 스냅샷(표시전용, 비키). non-empty만 착지 → 미동봉/공백 = undefined(회귀 0).
    const customerRealPhone =
      (customerRealPhoneIn && customerRealPhoneIn.trim() !== '')
        ? customerRealPhoneIn.trim()
        : undefined;
    // slot_type → visit_type 매핑 (旣존 INSERT 로직과 동일). 미동봉 → 'new'(RPC 기본).
    const visitTypeMapped = slotType ? (slotType === 'new_consult' ? 'new' : 'returning') : 'new';
    // scheduled_at(ISO 8601) → date/time 분해 (INSERT·mutation 비교 공용)
    const scheduledDate = scheduledAt.substring(0, 10);   // "2026-05-25"
    const scheduledTime = scheduledAt.substring(11, 19);  // "14:30:00"

    // ── AC-5: 중복(멱등키) 체크 — external_id 기존 여부 ─────────────────────────
    //   UNIQUE partial index (source_system IS NOT NULL AND external_id IS NOT NULL).
    //   T-20260630-FOOTRESV-TM-EDIT-CANCEL (FIX/reopen): 기존 행 발견 시 무조건 duplicate 단락하던 것을
    //   (a) 취소요청 / (b) 리스케줄(시간 변경) 이면 RPC upsert_reservation_from_source 의 cancel/UPDATE 분기로
    //   라우팅하도록 분기 추가. 순수 동일-payload 재push 만 멱등 duplicate 유지(guard#2 불변).
    const { data: existing } = await admin
      .from('reservations')
      .select('id, reservation_date, reservation_time, status')
      .eq('source_system', sourceSystem ?? 'dopamine')
      .eq('external_id', externalId)
      .maybeSingle();

    if (existing) {
      const isCancelRequest = (statusIn ?? '').toLowerCase().trim() === 'cancelled';
      // 리스케줄 판정: 도파민이 운반한 date/time 이 기존 착지값과 다른가. (TIME 은 "HH:MM:SS" 8자 비교)
      const curDate = (existing.reservation_date as string | null) ?? '';
      const curTime = ((existing.reservation_time as string | null) ?? '').substring(0, 8);

      // ── T-20260719-foot-DOPAMINE-RESCHED-INGEST-5XX-DIAG: reschedule 경계 캐스팅 방어 (RC 픽스) ──
      //   [RC] 도파민 '날짜 변경'(reschedule) push 는 새 날짜만 운반하고 time 을 빈/malformed 로 조립할 수
      //     있다(예 scheduled_at='2026-07-21T+09:00' — cancel H3(T-20260707) 와 동형 ISO 잔해;
      //     date 부분=OK, time 부분 substring(11,19)='+09:00' = 비-TIME). 그러면 rpcTime='+09:00' 이
      //     RPC 의 p_reservation_time(TIME) PostgREST 경계 캐스팅에서 22007 hard-fail → RPC 미실행 →
      //     500 INTERNAL(도파민 '풋센터 반영 실패'). 신규 push 는 EF 직접 INSERT(RPC 미경유·full scheduled_at)
      //     라 정상 → reschedule(UPDATE/RPC)만 5xx (INSERT vs UPDATE 분기 확인, 착안 3 규명).
      //     cancel 은 이미 existing known-good 폴백으로 방어(H3)했으나 reschedule 은 미방어였다 —
      //     EDIT 테스트(T-20260707 AC1)가 항상 full valid scheduled_at 만 써서 GREEN 오탐.
      //   [FIX] malformed date/time 은 existing 행의 known-good 값으로 폴백. '날짜 변경'=time 보존이 정확한
      //     시맨틱(날짜만 바뀜). 유효한 신규 date/time 은 그대로 사용 → 회귀 0. self-mint scope/guard#5 는
      //     RPC 가 source_system+external_id 로만 판정하므로 결과 불변. no-DDL(스키마/제약 위반 아님 — 순수
      //     EF 경계 캐스팅 로직 결함 → db_change=false 유지).
      const safeDate = isValidDate(scheduledDate) ? scheduledDate : (curDate || scheduledDate);
      const safeTime = isValidTime(scheduledTime) ? scheduledTime.substring(0, 8) : (curTime || scheduledTime);
      if (safeDate !== scheduledDate || safeTime !== scheduledTime.substring(0, 8)) {
        console.warn(`[reservation-ingest] reschedule malformed scheduled_at guard: ext=${externalId} raw='${scheduledAt}' → date=${safeDate} time=${safeTime} (existing known-good fallback)`);
      }

      const isReschedule = curDate !== safeDate || curTime !== safeTime;

      // (guard#2) 순수 동일-payload 재push (취소·리스케줄 아님) → 멱등 duplicate 유지.
      //   예약메모(rmh)만 멱등 upsert(편집 재push 로 수정된 메모 timeline 반영). 빈값=내부 no-op.
      if (!isCancelRequest && !isReschedule) {
        await syncReservationMemoToTimeline(admin, existing.id as string, clinicId, memo, sourceSystem ?? 'dopamine');
        // T-20260708-FOOTRESV-NAILPROB-SUBFILTER-PUSH: 간략메모도 순수 재push 에서 멱등 반영.
        //   문제성발톱을 기존 예약(시간 무변경)에 뒤늦게 추가/변경 → 이 duplicate 분기로 유입되므로
        //   brief_note 를 놓치면 4번이 이 경로에서 재발. COALESCE-보존(non-empty만 UPDATE, 빈값=기존 보존)
        //   = RPC ON CONFLICT 라인과 동일 semantics · idempotent-no-op 계약 유지(빈값/동일값 무영향).
        if (briefNote && briefNote.trim() !== '') {
          const bn = briefNote.trim();
          const { error: bnErr } = await admin
            .from('reservations')
            .update({ brief_note: bn })
            .eq('id', existing.id as string);
          if (bnErr) console.error(`[reservation-ingest] brief_note update failed rid=${existing.id}: ${bnErr.message}`);
        }
        console.log(`[reservation-ingest] duplicate (idempotent no-op) external_id ${externalId} → existing ${existing.id} brief_note=${(briefNote ?? '').trim() || '-'}`);
        return json({ ok: true, reservation_id: existing.id, applied: false, reason: 'duplicate' });
      }

      // ── (a) 취소 / (b) 리스케줄 → RPC upsert_reservation_from_source 로 라우팅 ─────────────────
      //   RPC(20260630193000 최종 body)가 guard#5 lifecycle(checked_in/done/no_show reject) ·
      //   guard#3 self-mint scope(source_system 매치) · guard#2 멱등 · UPDATE/cancel 분기를 소유(SSOT).
      //   EF 는 duplicate 앞단에서 튕기지 않고 이 SSOT 로 위임 → 무음 no-op 재발 차단.
      //   phone: normalize_phone(+82…) = no-op(이미 E.164) → 기존 customers 행과 동일키 유지(fork 방지).
      //
      // ── T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL (FIX/field-soak reopen, RCA H3) ───────────────
      //   근본원인(prod 로그 규명, 17:53:46-48 KST): 도파민 CANCEL push 가 reservation.scheduled_at
      //   ='T+09:00'(빈 date/time 로 조립된 ISO 잔해)을 운반 → 본 EF 가 scheduledAt.substring(0,10)
      //   ='T+09:00' 을 p_reservation_date(DATE) 로 그대로 전달 → PostgREST 가 함수 body 실행 前
      //   인자 타입 캐스팅 단계에서 'invalid input syntax for type date: "T+09:00"' 로 실패
      //   → RPC 미실행 → EF 500 INTERNAL(→ 도파민 "저장 실패" 토스트). CANCEL fast-path 는 date/time 을
      //   전혀 사용하지 않음에도 경계 캐스팅에서 hard-fail. (EDIT/리스케줄은 실 date 운반 → 정상, 회귀 금지.)
      //   ★ 방어 픽스(CANCEL 한정): 취소는 payload date 가 무의미 → 이미 조회한 existing 행의 known-good
      //     reservation_date/time 을 RPC 로 넘겨 경계 캐스팅을 항상 통과시킨다. self-mint scope·guard#5 는
      //     RPC 가 source_system+external_id 로만 판정하므로 결과 불변. EDIT 경로(scheduledDate/Time)는 무변경.
      //     (emit-side 진짜 결함=도파민 cancel push 가 malformed scheduled_at 발신 → dev-dopamine 별도 조치 +
      //      DOPAMINE_CALLBACK_SECRET 게이트 CANCEL 실 write E2E 재검증 = dev-dopamine 몫.)
      //   EDIT/reschedule 경로: safeDate/safeTime(malformed 이면 existing known-good 폴백) 사용 →
      //   경계 캐스팅 항상 통과(T-20260719 RC 픽스). CANCEL 경로는 旣존 방어(H3) 무변경.
      const rpcDate = isCancelRequest
        ? ((existing.reservation_date as string | null) ?? scheduledDate)
        : safeDate;
      const rpcTime = isCancelRequest
        ? (((existing.reservation_time as string | null) ?? scheduledTime).substring(0, 8))
        : safeTime;
      const rpcArgs = {
        p_source_system:      sourceSystem ?? 'dopamine',
        p_external_id:        externalId,
        p_clinic_slug:        lookupSlug,
        p_customer_phone:     (!isCompanion && phoneE164) ? phoneE164 : null,
        p_customer_name:      name,
        p_reservation_date:   rpcDate,
        p_reservation_time:   rpcTime,
        p_memo:               (memo ?? '').trim() !== '' ? memo : null,
        p_status:             isCancelRequest ? 'cancelled' : 'confirmed',
        p_visit_type:         visitTypeMapped,
        p_created_via:        createdVia,
        p_service_id:         serviceId,
        p_registrar_id:       registrarId,
        p_registrar_name:     registrarNameLanded,
        p_customer_real_name: customerRealName ?? null,
        // T-20260721-foot-COMPANION-PHONE-EXPOSE: 동행 실연락처 → reservations.customer_real_phone(표시전용·비키).
        p_customer_real_phone: customerRealPhone ?? null,
        p_is_companion:       isCompanion,
        // T-20260708-FOOTRESV-NAILPROB-SUBFILTER-PUSH: 간략메모 배선(edit/reschedule 재push 반영).
        //   RPC ON CONFLICT = COALESCE 보존 — 빈값이면 기존 brief_note 유지(no-op). (취소 fast-path는 brief_note 미터치.)
        p_brief_note:         (briefNote ?? '').trim() !== '' ? briefNote : null,
      };
      const { data: rpcRid, error: rpcErr } = await admin.rpc('upsert_reservation_from_source', rpcArgs);

      if (rpcErr) {
        // guard#5: lifecycle-invalid(checked_in/done/no_show) stale edit/cancel → reject(무음 clobber 금지).
        //   RPC RAISE P0001(HINT=LIFECYCLE_INVALID) → 4xx 로 회신(도파민 no-retry, crm_sync_status='failed' reject UX).
        if ((rpcErr as { code?: string }).code === 'P0001') {
          console.warn(`[reservation-ingest] lifecycle-invalid ${isCancelRequest ? 'cancel' : 'edit'} rejected external_id=${externalId}: ${rpcErr.message}`);
          return json({ ok: false, error: 'LIFECYCLE_INVALID', detail: rpcErr.message }, 409);
        }
        console.error(`[reservation-ingest] RPC ${isCancelRequest ? 'cancel' : 'edit'} failed external_id=${externalId}: ${rpcErr.message}`);
        return json({ ok: false, error: 'INTERNAL', detail: `rpc upsert failed: ${rpcErr.message}` }, 500);
      }

      // rpcRid: 취소=self-mint 행 id(이미 cancelled=멱등 id), 리스케줄=UPDATE 행 id. 방어적 fallback=existing.id.
      const ridResolved = (rpcRid as string | null) ?? (existing.id as string);
      // 예약메모 SoT=rmh 동기화: RPC 는 reservations.memo(deprecated·FE 미read)에만 기록 → FE 가 read 하는 rmh 는 별도 sync.
      await syncReservationMemoToTimeline(admin, ridResolved, clinicId, memo, sourceSystem ?? 'dopamine');
      console.log(`[reservation-ingest] ${isCancelRequest ? 'CANCEL' : 'EDIT'} applied external_id=${externalId} → ${ridResolved} date=${scheduledDate} time=${scheduledTime} status=${isCancelRequest ? 'cancelled' : 'confirmed'}`);
      return json({ ok: true, reservation_id: ridResolved, applied: true, reason: isCancelRequest ? 'cancelled' : 'rescheduled' });
    }

    // ── AC-4: Customer upsert (clinic_id + phone_e164 기준) ─────────────────
    // B-8 (T-20260627-foot-INGEST-CLINIC-SCOPED-LOOKUP):
    //   고객조회에 clinic_id 술어 추가. customers UNIQUE = (clinic_id, phone digits)
    //   이므로 phone 단독 조회는 멀티지점(jongno-foot 1,391명 + songdo-foot)에서
    //   동일 phone 양 지점 동시 존재 시 다중행→maybeSingle 에러→무시→오삽입 경로로
    //   500을 유발. clinic_id 스코핑으로 0/1행을 보장하고, 조회 에러를 명시 처리한다.
    // ── 동행(§444/§52): customers 링크·phone 역조회 절대 금지 → customer_id=NULL 착지. ──
    //   비동행만 (clinic_id, phone) lookup/upsert (기존 경로 0-회귀). 동행은 아래 블록 전체 skip.
    let customerId: string | null = null;
    // T-20260713-foot-INGEST-NAME-OVERWRITE-GUARD: 기존 고객 name no-touch 시 push 명을
    //   reservations.customer_real_name 스냅샷으로 착지시키기 위한 캐리어(비동행 INSERT 경로 전용).
    let pushNameSnapshot: string | null = null;
    if (!isCompanion) {
    const { data: existingCustomer, error: custLookupErr } = await admin
      .from('customers')
      .select('id, name, visit_route')        // GUARD: never-downgrade name + RESVROUTE-SYNC preserve-on-NULL 판정 위해 기존 visit_route 동반 조회
      .eq('clinic_id', clinicId)
      .eq('phone', phoneE164)
      .maybeSingle();

    if (custLookupErr) {
      console.error('[reservation-ingest] customer lookup DB error:', custLookupErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `customer lookup failed: ${custLookupErr.message}` }, 500);
    }

    if (existingCustomer) {
      customerId = existingCustomer.id as string;
      // ── T-20260713-foot-INGEST-NAME-OVERWRITE-GUARD (DA-20260713-CRM-INGEST-NAME-OVERWRITE-BAN, verdict=GO) ──
      //   [진원] 旣존 로직은 payload name 을 가드 없이 customers.name 에 override → 현장에서 정정한
      //          본명이 도파민 push 별칭('ok' 등)으로 재오염(bleed)됨. 이를 write-path 계약으로 교체.
      //   [계약] ① create-only: 신규 고객만 push 명 → 초기값(아래 else 블록 유지).
      //          ② 기존 행 = never-downgrade / no-touch: 기존 non-empty name 은 절대 미터치.
      //          ③ preserve-on-NULL: customers.name = COALESCE(NULLIF(btrim(push),''), customers.name).
      //          push 명은 유실 방지를 위해 reservations.customer_real_name 스냅샷으로 착지.
      //   ⚠ 트리거 trg_sync_customer_name 미접촉(정식 mirror, 버그 아님). DDL 0.
      const existingName = ((existingCustomer.name as string | null) ?? '').trim();
      const pushName     = (name ?? '').trim();
      // ③ preserve-on-NULL: 기존 name 이 공란일 때만 non-empty push 명으로 채움. 기존 non-empty 는 미터치.
      const shouldFillName = existingName === '' && pushName !== '';
      // ② no-touch: 기존 non-empty name 을 보존한 경우 push 명(다른 값)은 예약 스냅샷으로만 착지(유실 방지).
      if (existingName !== '' && pushName !== '' && pushName !== existingName) {
        pushNameSnapshot = pushName;
      }
      // ── T-20260714-foot-RESVROUTE-CUSTOMERS-SYNC-FIX: 예약경로(visit_route='TM') → 2번차트 방문경로(customers.visit_route) 연동 ──
      //   [RC / 초진 별도원인] 초진(new_consult) 다수가 도파민 TM 인입(본 EF)인데 customers.visit_route 를 seed 하지 않아
      //     2번차트 방문경로가 공란(prod Phase0 실측: dopamine 59/60 NULL). FE 게이트 제거(ALWAYSYNC)만으론 TM 초진이 안 고쳐짐 —
      //     TM 초진은 FE createReservationCanonical(line274) 경로를 애초에 타지 않고 이 EF 로 인입되기 때문.
      //   [계약] preserve-on-NULL(no-clobber): 기존 방문경로가 공란일 때만 visitRouteLanded('TM')로 채운다.
      //     현장이 수동 정정한 non-empty 방문경로는 절대 미터치(도파민 재push 로 인한 clobber 차단) — INGEST-NAME-OVERWRITE-GUARD 와 동일 철학.
      //     FE 신규경로(A안 last-write-wins, 사람이 방금 선택)와 채널 시맨틱 분리: 자동 인입은 보수적 fill-only.
      //   [G1] visit_route 단일 컬럼만 조건부 추가(타 컬럼 미접촉). [G3] source_system 무접촉(매출 split 불변).
      const existingVisitRoute = ((existingCustomer.visit_route as string | null) ?? '').trim();
      const shouldFillVisitRoute = existingVisitRoute === '' && !!visitRouteLanded;
      // 최신 정보 반영 + 광고 추적 필드 선택적 반영 (name 은 위 계약에 따라 조건부만 포함)
      await admin
        .from('customers')
        .update({
          ...(shouldFillName ? { name: pushName } : {}),   // GUARD: 공란 채움만, 덮어쓰기 금지
          // RESVROUTE-CUSTOMERS-SYNC-FIX: 방문경로 preserve-on-NULL fill (기존 공란일 때만, non-empty 미터치)
          ...(shouldFillVisitRoute ? { visit_route: visitRouteLanded } : {}),
          // birth_year: (C)DROP — 미적재 (T-20260630-foot-DOPAMINE-INGEST-BIRTHYEAR)
          ...(gender ? { gender } : {}),
          // campaign_id/adset_id/ad_id → customers 컬럼 (reservations 아님)
          ...(campaignId ? { campaign_id: campaignId } : {}),
          ...(adsetId    ? { adset_id:    adsetId    } : {}),
          ...(adId       ? { ad_id:       adId       } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId);
    } else {
      // 신규 고객 생성
      const insertPayload: Record<string, unknown> = {
        name,
        phone: phoneE164,
        clinic_id: clinicId,                          // DB 조회로 얻은 clinicId
        // T-20260714-foot-RESVROUTE-CUSTOMERS-SYNC-FIX (시나리오 0 = 신규 초진 첫 예약): 신규 TM 초진 고객 → 2번차트 방문경로 seed.
        //   visitRouteLanded(='TM' 등, VISIT_ROUTE_ENUM 검증 완료) 있을 때만 착지 → 미동봉/비enum 시 미삽입(NULL, 회귀 0).
        //   이 신규-고객 INSERT 경로가 '초진 다 빠짐' 의 실 write-path(첫 예약 = 첫 customers row 생성 시점).
        ...(visitRouteLanded ? { visit_route: visitRouteLanded } : {}),
        // birth_year: (C)DROP — 미적재 (T-20260630-foot-DOPAMINE-INGEST-BIRTHYEAR)
        ...(gender ? { gender } : {}),
        ...(campaignId ? { campaign_id: campaignId } : {}),
        ...(adsetId    ? { adset_id:    adsetId    } : {}),
        ...(adId       ? { ad_id:       adId       } : {}),
      };

      const { data: newCustomer, error: custErr } = await admin
        .from('customers')
        .insert(insertPayload)
        .select('id')
        .single();

      if (custErr || !newCustomer) {
        // 중복 phone race condition 처리
        if (custErr?.code === '23505') {
          // B-8: race-condition 재조회도 clinic_id 스코핑 (UNIQUE = clinic_id+phone).
          //   phone 단독 .single() 은 양지점 동시존재 시 다중행→throw 였음. clinic_id로
          //   0/1행 보장 + .maybeSingle() 로 0행 시에도 throw 대신 명시 분기.
          const { data: raceCustomer, error: raceLookupErr } = await admin
            .from('customers')
            .select('id')
            .eq('clinic_id', clinicId)
            .eq('phone', phoneE164)
            .maybeSingle();
          if (raceLookupErr || !raceCustomer) {
            return json({ ok: false, error: 'INTERNAL', detail: `customer race-condition: ${raceLookupErr?.message ?? custErr.message}` }, 500);
          }
          customerId = raceCustomer.id as string;
        } else {
          return json({ ok: false, error: 'INTERNAL', detail: `customer insert failed: ${custErr?.message}` }, 500);
        }
      } else {
        customerId = newCustomer.id as string;
      }
    }
    } // end if(!isCompanion) — 동행은 customerId=NULL 유지

    // ── AC-5: Reservation INSERT (신규) ───────────────────────────────────────
    //   scheduledDate/scheduledTime, createdVia, customerRealName, visitTypeMapped 는
    //   중복체크 前 선산출(edit/cancel RPC 라우팅과 공용). 여기서는 그 값을 그대로 사용.
    //   결함 1/2: reservation_date DATE NOT NULL, reservation_time TIME NOT NULL (scheduled_at 컬럼 없음).
    const rsvPayload: Record<string, unknown> = {
      customer_id:      customerId,
      // T-20260630-foot-INGEST-CUSTNAME-NULL-FIX: 예약관리 목록 '이름없음' 수정.
      //   reservations.customer_name denormalize 누락 → 목록 표시 NULL이었음.
      //   비-도파민 예약은 이미 채워지는 旣존 컬럼 — 동일 denormalize 패턴 정합.
      customer_name:    name,
      // T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING: 캘린더 호버 '번호 없음' 수정.
      //   FE(Reservations.tsx resvAsCheckIn→CustomerHoverCard)는 reservations.customer_phone
      //   스냅샷을 읽는데, 본 EF가 phone을 customers.phone에만 적재하고 reservations엔
      //   denormalize 누락 → 호버 공란이었음. customer_name과 동일 denormalize 패턴 정합.
      //   비동행만 적재: phoneE164는 이 경로에서 필수+E.164 검증 완료(:171-176)라
      //   reservations_customer_phone_e164_chk 정합 보장. 동행(§444)은 무폰 축(미검증 phone
      //   포함) → 미삽입, NULL 유지(설계상 정상, CHECK NULL 허용). CHECK 위반·오염 원천 차단.
      ...(!isCompanion && phoneE164 ? { customer_phone: phoneE164 } : {}),
      clinic_id:        clinicId,                          // DB 조회 결과 직접 할당 (조건부 아님)
      source_system:    sourceSystem ?? 'dopamine',
      created_via:      createdVia,                        // 생성경로 (enum v1.1 정합)
      external_id:      externalId,
      reservation_date: scheduledDate,                     // 결함 1: DATE NOT NULL 충족
      reservation_time: scheduledTime,                     // 결함 2: TIME NOT NULL 충족
      // scheduled_at 컬럼 없음 — 미삽입 (결함 4 수정)
      status:           'confirmed',
      // slot_type 컬럼 없음 → visit_type 으로 매핑 (결함 5 수정)
      ...(slotType ? { visit_type: slotType === 'new_consult' ? 'new' : 'returning' } : {}),
      // B-9: 해석된 service_id 만 착지(null이면 미삽입 → 컬럼 DEFAULT NULL 유지, 회귀 0)
      ...(serviceId ? { service_id: serviceId } : {}),
      // T-20260702-dopamine-FOOTRESV-MEMO-REPROBE: memo → reservations.memo 매핑 제거(timeline-only).
      //   reservations.memo = deprecated(FE 미read). 예약메모는 아래 insert 성공 후
      //   syncReservationMemoToTimeline() 으로 rmh(SoT)에 착지 → 예약상세 팝업·달력 hover 노출.
      //   (RPC 55f3f62d 의 'reservations.memo 매핑 제거' 와 동일 조치를 실 push 경로에도 적용.)
      // T-20260630-foot-INGEST-REGISTRAR-CREATEDBY (RECONCILE-FINAL):
      //   (b) registrar 표시축 — 해소된 FK(있을 때만) + 표시 라벨(매칭 스냅샷 or provenance).
      //       ⛔ 방화벽: 표시 전용 — created_by/stats 미승격. created_by는 미삽입(NULL graceful, (c)).
      //   (KEEP) visit_route='TM' — 旣존 enum, source_system='dopamine'(:335)과 직교 독립 set.
      ...(registrarId         ? { registrar_id: registrarId }            : {}),
      ...(registrarNameLanded ? { registrar_name: registrarNameLanded }  : {}),
      ...(visitRouteLanded    ? { visit_route: visitRouteLanded }        : {}),
      // T-20260630-foot-COMPANION-RESV-INSERT-FAIL (§4-2b): 동행명/본명 스냅샷(표시전용 폴백).
      //   비키 — JOIN/dedup/귀속 미사용. 동행(customer_id=NULL) 이름복원 1순위. NULL=정상.
      // T-20260713-foot-INGEST-NAME-OVERWRITE-GUARD: 기존 고객 name no-touch(②) 시 push 명 유실 방지 —
      //   우선순위: 명시 customer_real_name/동행명(customerRealName) → 없으면 no-touch push 명(pushNameSnapshot).
      ...((customerRealName ?? pushNameSnapshot) ? { customer_real_name: (customerRealName ?? pushNameSnapshot) } : {}),
      // T-20260721-foot-COMPANION-PHONE-EXPOSE: 동행 실연락처(표시전용·비키, INV-3) 착지 — 신규 push write-path.
      //   non-empty만 삽입 → NULL/미동봉 회귀 0. 예약상세 '동행자 연락처' 표시 소스. (RPC 라인과 정합.)
      ...(customerRealPhone ? { customer_real_phone: customerRealPhone } : {}),
      // T-20260708-FOOTRESV-NAILPROB-SUBFILTER-PUSH: 간략메모(문제성발톱 등) 착지.
      //   ★ 이 신규 INSERT 경로가 첫 push(문제성발톱 선택→풋 예약상세 간략메모)의 실 write-path.
      //     brief_note = 旣존 컬럼(TEXT NULL). non-empty만 삽입 → NULL/미동봉 회귀 0. (RPC 라인과 정합.)
      ...(briefNote && briefNote.trim() !== '' ? { brief_note: briefNote.trim() } : {}),
      // campaign_id/adset_id/ad_id 는 customers 컬럼 — reservations에서 제거 (결함 5 수정)
    };

    const { data: newRsv, error: rsvErr } = await admin
      .from('reservations')
      .insert(rsvPayload)
      .select('id')
      .single();

    if (rsvErr) {
      // UNIQUE 위반 — race condition 중복
      if (rsvErr.code === '23505') {
        const { data: raceRsv } = await admin
          .from('reservations')
          .select('id')
          .eq('source_system', sourceSystem ?? 'dopamine')
          .eq('external_id', externalId)
          .single();
        if (raceRsv) {
          // T-20260702-dopamine-FOOTRESV-MEMO-REPROBE: race 중복도 예약메모 rmh 멱등 upsert(위와 동일).
          await syncReservationMemoToTimeline(admin, raceRsv.id as string, clinicId, memo, sourceSystem ?? 'dopamine');
          return json({ ok: true, reservation_id: raceRsv.id, applied: false, reason: 'duplicate' });
        }
      }
      return json({ ok: false, error: 'INTERNAL', detail: `reservation insert failed: ${rsvErr.message}` }, 500);
    }

    if (!newRsv) {
      return json({ ok: false, error: 'INTERNAL', detail: 'reservation insert returned no data' }, 500);
    }

    // T-20260702-dopamine-FOOTRESV-MEMO-REPROBE: 예약메모를 rmh(SoT)에 착지(빈값 skip·멱등).
    await syncReservationMemoToTimeline(admin, newRsv.id as string, clinicId, memo, sourceSystem ?? 'dopamine');

    console.log(`[reservation-ingest] OK external_id=${externalId} reservation_id=${newRsv.id} customer_id=${customerId ?? 'NULL'} is_companion=${isCompanion} customer_real_name=${customerRealName ?? '-'} clinic_slug=${clinicSlug} clinic_id=${clinicId} service_code=${serviceCode ?? '-'} service_id=${serviceId ?? '-'} created_via=${createdVia} visit_route=${visitRouteLanded ?? '-'} registrar_id=${registrarId ?? '-'} registrar_name=${registrarNameLanded ?? '-'}`);
    return json({ ok: true, reservation_id: newRsv.id, applied: true });

  } catch (err) {
    console.error('[reservation-ingest] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
