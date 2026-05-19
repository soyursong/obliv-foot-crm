/**
 * nhis-lookup — 건보공단 수진자 자격조회 Edge Function
 *
 * T-20260515-foot-KENBO-API-NATIVE (골격)
 * T-20260520-foot-NHIS-HARDEN      (보안 보강 Phase b+c)
 *
 * POST /functions/v1/nhis-lookup
 * Body: { customer_id: string }
 * Auth: Supabase Bearer JWT (authenticated user)
 *
 * ── Edge Secrets (AC-6) ──────────────────────────────────────────
 *   Supabase Dashboard > Project Settings > Edge Functions > Secrets
 *   NHIS_API_URL       — NHIS 수진자 자격조회 API 엔드포인트
 *                        예: https://apis.nhis.or.kr/api/v1/qlfc/qlfcInq
 *   NHIS_API_KEY       — NHIS Open API 인증키 (Bearer token)
 *   NHIS_FACILITY_CODE — 요양기관기호 (예: 12345678)
 *
 * ── 개발/운영 분리 (AC-8) ────────────────────────────────────────
 *   NHIS_MOCK=true     — dev 환경 모의 응답 활성화 (AC-7)
 *                        dev Secrets에만 설정, prod는 미설정
 *   미설정 시 → NHIS_NOT_CONFIGURED 에러코드 반환 (graceful)
 *
 * 응답:
 *   200: { grade, copayment_rate, effective_date, raw }
 *         raw의 RRN 필드는 앞6자리만 노출, 뒤7자리 마스킹 (AC-2)
 *   400: { error: 'MISSING_CUSTOMER_ID' | 'INVALID_BODY' }
 *   401: { error: 'UNAUTHORIZED' }
 *   403: { error: 'CLINIC_MISMATCH' }     — IDOR 시도 차단 (AC-3)
 *   422: { error: 'RRN_MISSING' }         — RRN 미입력
 *   500: { error: 'RRN_DECRYPT_FAILED' }
 *   502: { error: 'NHIS_API_ERROR', detail }
 *   503: { error: 'NHIS_NOT_CONFIGURED' } — 환경변수 미설정
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FALLBACK_URL = 'https://medicare.nhis.or.kr/portal/refer/selectReferInq.do';

// ── AC-4: mapQualificationCode — 산정특례·경감 정확화 ─────────────────────
/**
 * NHIS 자격구분코드(qualCode) + 부담구분코드(burdenCode) → InsuranceGrade
 *
 * qualCode 매핑 (건강보험심사평가원 자격코드 표준):
 *   '1' = 건강보험 직장가입자
 *   '2' = 건강보험 지역가입자
 *   '3' = 의료급여 1종
 *   '4' = 의료급여 2종
 *   '5' = 차상위 1종 (희귀질환)
 *   '6' = 차상위 2종 (만성질환)
 *   '9' = 외국인·재외국민
 *
 * burdenCode 매핑 (부담구분코드 — qualCode '1'|'2' 세분):
 *   '1' = 일반 외래 (30%)
 *   '3' = 경감 (임신·출산·장애 등, 10~20%)
 *   '5' = 영유아 감면 (5~10%)
 *   '6' = 65세 이상 정액
 *   '7' = 산정특례 (중증질환·희귀난치, 5%)
 *   '8' = 희귀난치·중증난치 (10%)
 *   '9' = 보훈 (5~20%)
 */
export function mapQualificationCode(
  qualCode: string | undefined,
  burdenCode: string | undefined,
): string {
  // 의료급여
  if (qualCode === '3') return 'medical_aid_1';
  if (qualCode === '4') return 'medical_aid_2';

  // 차상위
  if (qualCode === '5') return 'low_income_1';
  if (qualCode === '6') return 'low_income_2';

  // 건강보험 (직장·지역) — 부담구분코드 세분
  if (qualCode === '1' || qualCode === '2') {
    // AC-4: 산정특례 (중증질환 5%, 희귀난치 10%)
    if (burdenCode === '7') return 'catastrophic_exemption';
    // AC-4: 희귀난치·중증난치 별도 구분
    if (burdenCode === '8') return 'rare_disease';
    // AC-4: 경감 (임신·출산·장애·기저질환)
    if (burdenCode === '3') return 'reduction';
    // AC-4: 보훈 대상자
    if (burdenCode === '9') return 'veterans';
    // 기존
    if (burdenCode === '6') return 'elderly_flat';   // 65세 정액
    if (burdenCode === '5') return 'infant';          // 영유아 감면
    return 'general';
  }

  // 외국인·재외국민
  if (qualCode === '9') return 'foreigner';

  return 'unverified';
}

// ── AC-2: maskRrnInRaw — raw 응답 내 주민번호 마스킹 ─────────────────────
/**
 * NHIS raw 응답 객체 내 13자리 숫자(주민번호 패턴)를 앞6*뒤7로 마스킹.
 * 중첩 객체·배열도 재귀 처리.
 */
export function maskRrnInRaw(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      const digits = val.replace(/\D/g, '');
      if (digits.length === 13) {
        // 앞 6자리만 노출, 뒤 7자리 마스킹
        result[key] = `${digits.slice(0, 6)}*******`;
      } else {
        result[key] = val;
      }
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = maskRrnInRaw(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      result[key] = val.map((item) =>
        typeof item === 'object' && item !== null
          ? maskRrnInRaw(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** NHIS 부담율 텍스트 → 숫자(%) */
function parseCopayRate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (Number.isNaN(n)) return null;
  // API가 0~100 범위로 내려주는 경우
  if (n > 1) return n;
  // 0~1 범위면 100 곱하기
  return Math.round(n * 100);
}

// ── AC-7: dev 환경 모의 응답 ─────────────────────────────────────────────
/**
 * NHIS_MOCK=true 시 반환할 모의 응답.
 * dev Supabase 프로젝트 Edge Secrets에만 설정.
 * prod에는 NHIS_MOCK 미설정 (환경 분리 AC-8).
 */
function buildMockResponse(rrn13: string): Record<string, unknown> {
  const masked = `${rrn13.slice(0, 6)}*******`;
  return {
    qualCd: '1',
    burdenCd: '1',
    copayRate: 30,
    applyBgngYmd: '20250101',
    rsdntNo: masked,  // 모의 응답도 마스킹
    _mock: true,
  };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // JWT 인증
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'UNAUTHORIZED' }),
      { status: 401, headers: corsHeaders },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userToken = authHeader.slice(7);

  // 사용자 JWT 검증 (anon client로 getUser)
  const anonClient = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(userToken);
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: 'UNAUTHORIZED' }),
      { status: 401, headers: corsHeaders },
    );
  }

  // 요청 파싱
  let body: { customer_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'INVALID_BODY' }),
      { status: 400, headers: corsHeaders },
    );
  }

  const { customer_id } = body;
  if (!customer_id) {
    return new Response(
      JSON.stringify({ error: 'MISSING_CUSTOMER_ID' }),
      { status: 400, headers: corsHeaders },
    );
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  // ── AC-3: IDOR 가드 ───────────────────────────────────────────────────
  // 호출자 clinic_id ≠ customer.clinic_id → 403 + 감사 로그
  const [profileRes, customerRes] = await Promise.all([
    adminClient
      .from('user_profiles')
      .select('clinic_id')
      .eq('id', user.id)
      .single(),
    adminClient
      .from('customers')
      .select('clinic_id')
      .eq('id', customer_id)
      .single(),
  ]);

  // 고객 미존재
  if (customerRes.error || !customerRes.data) {
    return new Response(
      JSON.stringify({ error: 'CUSTOMER_NOT_FOUND' }),
      { status: 404, headers: corsHeaders },
    );
  }

  const callerClinicId = profileRes.data?.clinic_id ?? null;
  const customerClinicId = customerRes.data.clinic_id;

  if (!callerClinicId || callerClinicId !== customerClinicId) {
    // 감사 로그 기록 (fire-and-forget — await로 블록하지 않음)
    adminClient.from('nhis_idor_audit_logs').insert({
      event_type: 'IDOR_ATTEMPT',
      user_id: user.id,
      customer_id,
      caller_clinic_id: callerClinicId,
      customer_clinic_id: customerClinicId,
      ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
      detail: `caller_clinic=${callerClinicId} customer_clinic=${customerClinicId}`,
    }).then(({ error: logErr }) => {
      if (logErr) console.error('[nhis-lookup] IDOR audit log insert failed:', logErr.message);
    });

    return new Response(
      JSON.stringify({
        error: 'CLINIC_MISMATCH',
        detail: '요청 클리닉과 고객 클리닉이 일치하지 않습니다.',
      }),
      { status: 403, headers: corsHeaders },
    );
  }

  // ── AC-6: 환경변수 확인 (Edge Secrets) ──────────────────────────────────
  const nhisApiUrl = Deno.env.get('NHIS_API_URL');
  const nhisApiKey = Deno.env.get('NHIS_API_KEY');
  const nhisFacilityCode = Deno.env.get('NHIS_FACILITY_CODE');

  // ── AC-7: NHIS_MOCK=true → 모의 응답 분기 (dev 전용) ────────────────────
  const nhisMock = Deno.env.get('NHIS_MOCK') === 'true';

  // 실 API 미설정이면서 mock도 아닐 때 graceful degradation
  if (!nhisMock && (!nhisApiUrl || !nhisApiKey || !nhisFacilityCode)) {
    return new Response(
      JSON.stringify({
        error: 'NHIS_NOT_CONFIGURED',
        fallback_url: FALLBACK_URL,
        detail: '건보공단 API 환경변수가 설정되지 않았습니다. Supabase Edge Function Secrets를 확인하세요.',
      }),
      { status: 503, headers: corsHeaders },
    );
  }

  // service role 클라이언트로 RRN 복호화
  const { data: rrn, error: rrnErr } = await adminClient.rpc('rrn_decrypt', {
    customer_uuid: customer_id,
  });

  if (rrnErr) {
    return new Response(
      JSON.stringify({ error: 'RRN_DECRYPT_FAILED', detail: rrnErr.message }),
      { status: 500, headers: corsHeaders },
    );
  }

  if (!rrn || String(rrn).replace(/\D/g, '').length < 13) {
    return new Response(
      JSON.stringify({
        error: 'RRN_MISSING',
        fallback_url: FALLBACK_URL,
        detail: '주민등록번호가 입력되지 않았습니다. 고객 차트에서 주민번호를 먼저 입력하세요.',
      }),
      { status: 422, headers: corsHeaders },
    );
  }

  const rrn13 = String(rrn).replace(/\D/g, '');

  // ── AC-7: mock 분기 처리 ─────────────────────────────────────────────────
  let nhisRaw: Record<string, unknown>;

  if (nhisMock) {
    nhisRaw = buildMockResponse(rrn13);
  } else {
    // NHIS Open API 호출
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const nhisRes = await fetch(nhisApiUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${nhisApiKey}`,
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          yadmNm: nhisFacilityCode,
          rsdntNo: rrn13,
          inqDt: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!nhisRes.ok) {
        const errText = await nhisRes.text().catch(() => '');
        return new Response(
          JSON.stringify({
            error: 'NHIS_API_ERROR',
            fallback_url: FALLBACK_URL,
            detail: `NHIS API HTTP ${nhisRes.status}: ${errText.slice(0, 200)}`,
          }),
          { status: 502, headers: corsHeaders },
        );
      }

      nhisRaw = await nhisRes.json();
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError';
      return new Response(
        JSON.stringify({
          error: 'NHIS_API_ERROR',
          fallback_url: FALLBACK_URL,
          detail: isTimeout ? '건보공단 API 응답 시간 초과 (8s)' : String(err),
        }),
        { status: 502, headers: corsHeaders },
      );
    }
  }

  // 응답 파싱
  const qualCode = String(nhisRaw['qualCd'] ?? nhisRaw['qualificationCode'] ?? nhisRaw['자격구분코드'] ?? '');
  const burdenCode = String(nhisRaw['burdenCd'] ?? nhisRaw['burdenCode'] ?? nhisRaw['부담구분코드'] ?? '');
  const rawRate = nhisRaw['copayRate'] ?? nhisRaw['본인부담율'] ?? nhisRaw['copaymentRate'];
  const effectiveDate =
    String(nhisRaw['applyBgngYmd'] ?? nhisRaw['적용개시일'] ?? nhisRaw['effectiveDate'] ?? '').slice(0, 8);

  const grade = mapQualificationCode(qualCode || undefined, burdenCode || undefined);
  const copaymentRate = parseCopayRate(rawRate);

  const effectiveDateFormatted = effectiveDate.length === 8
    ? `${effectiveDate.slice(0, 4)}-${effectiveDate.slice(4, 6)}-${effectiveDate.slice(6, 8)}`
    : null;

  // ── AC-2: raw 응답 내 RRN 마스킹 ────────────────────────────────────────
  const maskedRaw = maskRrnInRaw(nhisRaw);

  return new Response(
    JSON.stringify({
      grade,
      copayment_rate: copaymentRate,
      effective_date: effectiveDateFormatted,
      raw: maskedRaw,
    }),
    { status: 200, headers: corsHeaders },
  );
});
