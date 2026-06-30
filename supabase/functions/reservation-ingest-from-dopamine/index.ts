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
 *       "birth_year": 1985,      // optional
 *       "gender": "F"            // optional
 *     },
 *     "reservation": {
 *       "scheduled_at": "2026-05-25T14:30:00+09:00",
 *       "slot_type": "new_consult",
 *       "service_code": "FC-PDL-01",          ← optional. 발톱/풋 service 태깅 (services.service_code)
 *       "memo": "도파민 TM 상담 메모",
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

// E.164 phone validation (+[country][number], 7-15 digits after +)
function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
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
  const name      = customer['name']       as string | undefined;
  // 동행명 스냅샷(§4-2b 비키): 명시 customer_real_name 우선 → 동행이면 name 폴백.
  const customerRealNameIn = customer['customer_real_name'] as string | undefined;

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
  const birthYear         = customer['birth_year']         as number | undefined;
  const gender            = customer['gender']             as string | undefined;
  // T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK: consent_marketing = 비-SSOT divergent 명칭
  //   (DA NO-GO as-named). 컬럼 DROP + 코드참조 동반 제거(가드B). 광고동의 canonical 거처=consent_ad.
  const slotType          = reservation['slot_type']       as string | undefined;
  const serviceCode       = reservation['service_code']    as string | undefined;
  const memo              = reservation['memo']            as string | undefined;
  const campaignId        = reservation['campaign_id']     as string | undefined;
  const adsetId           = reservation['adset_id']        as string | undefined;
  const adId              = reservation['ad_id']           as string | undefined;
  // T-20260630-foot-INGEST-REGISTRAR-CREATEDBY (RECONCILE-FINAL §RE-SCOPE):
  //   registrar_name = 도파민이 운반한 로그인 TM 표시 라벨(provenance 표시축). reservation 블록 동봉.
  //   visit_route    = 방문경로(父 tier-1 push는 항상 'TM'). source_system='dopamine'과 직교 독립 set.
  //   ⛔ registrar_email/created_by 착지는 WITHDRAWN(§416 이중계상) — 수신/해소하지 않는다.
  const registrarName     = reservation['registrar_name']  as string | undefined;
  const visitRoute        = reservation['visit_route']     as string | undefined;

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

    // ── AC-5: 중복 체크 먼저 ─────────────────────────────────────────────────
    // UNIQUE partial index (source_system IS NOT NULL AND external_id IS NOT NULL)
    // 중복 시 기존 reservation_id 반환 (applied:false)
    const { data: existing } = await admin
      .from('reservations')
      .select('id')
      .eq('source_system', sourceSystem ?? 'dopamine')
      .eq('external_id', externalId)
      .maybeSingle();

    if (existing) {
      console.log(`[reservation-ingest] duplicate external_id ${externalId} → existing ${existing.id}`);
      return json({ ok: true, reservation_id: existing.id, applied: false, reason: 'duplicate' });
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
    if (!isCompanion) {
    const { data: existingCustomer, error: custLookupErr } = await admin
      .from('customers')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('phone', phoneE164)
      .maybeSingle();

    if (custLookupErr) {
      console.error('[reservation-ingest] customer lookup DB error:', custLookupErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `customer lookup failed: ${custLookupErr.message}` }, 500);
    }

    if (existingCustomer) {
      customerId = existingCustomer.id as string;
      // 최신 정보 반영 + 광고 추적 필드 선택적 반영
      await admin
        .from('customers')
        .update({
          name,
          ...(birthYear != null ? { birth_year: birthYear } : {}),
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
        ...(birthYear != null ? { birth_year: birthYear } : {}),
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

    // ── AC-5: Reservation INSERT ─────────────────────────────────────────────
    // 결함 1/2: scheduledAt(ISO 8601) → reservation_date + reservation_time 분리
    // DB: reservation_date DATE NOT NULL, reservation_time TIME NOT NULL (scheduled_at 컬럼 없음)
    const scheduledDate = scheduledAt.substring(0, 10);   // "2026-05-25"
    const scheduledTime = scheduledAt.substring(11, 19);  // "14:30:00"

    // T-20260628-crm-RESV-CREATED-VIA-FILL §2: 인입 예약 생성경로(created_via) 적재.
    //   canonical enum v1.1 9값과 정합. source_system 채널 → created_via 정합 매핑,
    //   미지/기본값은 dopamine(본 EF=도파민 인입 경로). ★별칭 금지(admin/phone/walk-in 미사용).
    const CREATED_VIA_BY_SOURCE: Record<string, string> = {
      dopamine: 'dopamine', aicc: 'aicc', naver: 'naver',
      meta: 'meta', kakao: 'kakao', inbound: 'inbound',
    };
    const createdVia = CREATED_VIA_BY_SOURCE[(sourceSystem ?? 'dopamine').toLowerCase()] ?? 'dopamine';

    // ── 동행명/본명 스냅샷 (T-20260630-foot-COMPANION-RESV-INSERT-FAIL, §4-2b 비키) ──
    //   명시 customer_real_name 우선 → 동행이면 name 폴백. 비동행 미동봉 → 미삽입(NULL, 0-회귀).
    //   동행(customer_id=NULL, customers 행 부재)의 캘린더/목록 이름복원 1순위 폴백.
    const customerRealName =
      (customerRealNameIn && customerRealNameIn.trim() !== '')
        ? customerRealNameIn.trim()
        : (isCompanion ? name : undefined);

    const rsvPayload: Record<string, unknown> = {
      customer_id:      customerId,
      // T-20260630-foot-INGEST-CUSTNAME-NULL-FIX: 예약관리 목록 '이름없음' 수정.
      //   reservations.customer_name denormalize 누락 → 목록 표시 NULL이었음.
      //   비-도파민 예약은 이미 채워지는 旣존 컬럼 — 동일 denormalize 패턴 정합.
      customer_name:    name,
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
      ...(memo     ? { memo } : {}),
      // T-20260630-foot-INGEST-REGISTRAR-CREATEDBY (RECONCILE-FINAL):
      //   (b) registrar 표시축 — 해소된 FK(있을 때만) + 표시 라벨(매칭 스냅샷 or provenance).
      //       ⛔ 방화벽: 표시 전용 — created_by/stats 미승격. created_by는 미삽입(NULL graceful, (c)).
      //   (KEEP) visit_route='TM' — 旣존 enum, source_system='dopamine'(:335)과 직교 독립 set.
      ...(registrarId         ? { registrar_id: registrarId }            : {}),
      ...(registrarNameLanded ? { registrar_name: registrarNameLanded }  : {}),
      ...(visitRouteLanded    ? { visit_route: visitRouteLanded }        : {}),
      // T-20260630-foot-COMPANION-RESV-INSERT-FAIL (§4-2b): 동행명/본명 스냅샷(표시전용 폴백).
      //   비키 — JOIN/dedup/귀속 미사용. 동행(customer_id=NULL) 이름복원 1순위. NULL=정상.
      ...(customerRealName    ? { customer_real_name: customerRealName }  : {}),
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
          return json({ ok: true, reservation_id: raceRsv.id, applied: false, reason: 'duplicate' });
        }
      }
      return json({ ok: false, error: 'INTERNAL', detail: `reservation insert failed: ${rsvErr.message}` }, 500);
    }

    if (!newRsv) {
      return json({ ok: false, error: 'INTERNAL', detail: 'reservation insert returned no data' }, 500);
    }

    console.log(`[reservation-ingest] OK external_id=${externalId} reservation_id=${newRsv.id} customer_id=${customerId ?? 'NULL'} is_companion=${isCompanion} customer_real_name=${customerRealName ?? '-'} clinic_slug=${clinicSlug} clinic_id=${clinicId} service_code=${serviceCode ?? '-'} service_id=${serviceId ?? '-'} created_via=${createdVia} visit_route=${visitRouteLanded ?? '-'} registrar_id=${registrarId ?? '-'} registrar_name=${registrarNameLanded ?? '-'}`);
    return json({ ok: true, reservation_id: newRsv.id, applied: true });

  } catch (err) {
    console.error('[reservation-ingest] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
