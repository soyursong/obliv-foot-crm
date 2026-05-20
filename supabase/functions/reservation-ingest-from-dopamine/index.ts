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
 *     "external_id": "<cue_card_id UUID>",
 *     "clinic_slug": "foot-jongno",         ← 필수 (DB 조회용)
 *     "customer": {
 *       "phone_e164": "+82102345...",
 *       "name": "홍길동",
 *       "birth_year": 1985,      // optional
 *       "gender": "F",           // optional
 *       "consent_marketing": true // optional
 *     },
 *     "reservation": {
 *       "scheduled_at": "2026-05-25T14:30:00+09:00",
 *       "slot_type": "new_consult",
 *       "memo": "도파민 TM 상담 메모",
 *       "campaign_id": "...",
 *       "adset_id": "...",
 *       "ad_id": "..."
 *     }
 *   }
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

  // customer 필수 필드
  const phoneE164 = customer['phone_e164'] as string | undefined;
  const name      = customer['name']       as string | undefined;
  if (!phoneE164 || !name) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'customer.phone_e164 and customer.name required' }, 400);
  }

  // AC-4: E.164 포맷 검증
  if (!isE164(phoneE164)) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: `customer.phone_e164 '${phoneE164}' is not valid E.164` }, 400);
  }

  // reservation 필수 필드
  const scheduledAt = reservation['scheduled_at'] as string | undefined;
  if (!scheduledAt) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'reservation.scheduled_at required' }, 400);
  }

  // ── 선택 필드 추출 ─────────────────────────────────────────────────────────
  const birthYear         = customer['birth_year']         as number | undefined;
  const gender            = customer['gender']             as string | undefined;
  const consentMarketing  = customer['consent_marketing']  as boolean | undefined;
  const slotType          = reservation['slot_type']       as string | undefined;
  const memo              = reservation['memo']            as string | undefined;
  const campaignId        = reservation['campaign_id']     as string | undefined;
  const adsetId           = reservation['adset_id']        as string | undefined;
  const adId              = reservation['ad_id']           as string | undefined;

  // ── Supabase service role client ──────────────────────────────────────────
  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin        = createClient(supabaseUrl, serviceKey);

  try {
    // ── 결함 3 강화: clinic_slug → clinics.id DB 조회 ─────────────────────────
    // v2: FOOT_CLINIC_ID env var 의존 제거 — DB에서 직접 slug→id 매핑
    const { data: clinicRow, error: clinicLookupErr } = await admin
      .from('clinics')
      .select('id')
      .eq('slug', clinicSlug)
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

    // ── AC-4: Customer upsert (phone_e164 기준) ────────────────────────────
    let customerId: string;
    const { data: existingCustomer } = await admin
      .from('customers')
      .select('id')
      .eq('phone', phoneE164)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id as string;
      // 최신 정보 반영 + 광고 추적 필드 선택적 반영
      await admin
        .from('customers')
        .update({
          name,
          ...(birthYear != null ? { birth_year: birthYear } : {}),
          ...(gender ? { gender } : {}),
          ...(consentMarketing != null ? { consent_marketing: consentMarketing } : {}),
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
        ...(consentMarketing != null ? { consent_marketing: consentMarketing } : {}),
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
          const { data: raceCustomer } = await admin
            .from('customers')
            .select('id')
            .eq('phone', phoneE164)
            .single();
          if (!raceCustomer) {
            return json({ ok: false, error: 'INTERNAL', detail: `customer race-condition: ${custErr.message}` }, 500);
          }
          customerId = raceCustomer.id as string;
        } else {
          return json({ ok: false, error: 'INTERNAL', detail: `customer insert failed: ${custErr?.message}` }, 500);
        }
      } else {
        customerId = newCustomer.id as string;
      }
    }

    // ── AC-5: Reservation INSERT ─────────────────────────────────────────────
    // 결함 1/2: scheduledAt(ISO 8601) → reservation_date + reservation_time 분리
    // DB: reservation_date DATE NOT NULL, reservation_time TIME NOT NULL (scheduled_at 컬럼 없음)
    const scheduledDate = scheduledAt.substring(0, 10);   // "2026-05-25"
    const scheduledTime = scheduledAt.substring(11, 19);  // "14:30:00"

    const rsvPayload: Record<string, unknown> = {
      customer_id:      customerId,
      clinic_id:        clinicId,                          // DB 조회 결과 직접 할당 (조건부 아님)
      source_system:    sourceSystem ?? 'dopamine',
      external_id:      externalId,
      reservation_date: scheduledDate,                     // 결함 1: DATE NOT NULL 충족
      reservation_time: scheduledTime,                     // 결함 2: TIME NOT NULL 충족
      // scheduled_at 컬럼 없음 — 미삽입 (결함 4 수정)
      status:           'confirmed',
      // slot_type 컬럼 없음 → visit_type 으로 매핑 (결함 5 수정)
      ...(slotType ? { visit_type: slotType === 'new_consult' ? 'new' : 'returning' } : {}),
      ...(memo     ? { memo } : {}),
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

    console.log(`[reservation-ingest] OK external_id=${externalId} reservation_id=${newRsv.id} customer_id=${customerId} clinic_slug=${clinicSlug} clinic_id=${clinicId}`);
    return json({ ok: true, reservation_id: newRsv.id, applied: true });

  } catch (err) {
    console.error('[reservation-ingest] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
