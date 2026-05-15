/**
 * nhis-lookup — 건보공단 수진자 자격조회 Edge Function
 *
 * T-20260515-foot-KENBO-API-NATIVE
 *
 * POST /functions/v1/nhis-lookup
 * Body: { customer_id: string }
 * Auth: Supabase Bearer JWT (authenticated user)
 *
 * 환경변수 (Supabase Dashboard > Project Settings > Edge Functions):
 *   NHIS_API_URL       — NHIS 수진자 자격조회 API 엔드포인트
 *                        (예: https://apis.nhis.or.kr/api/v1/qlfc/qlfcInq)
 *   NHIS_API_KEY       — NHIS Open API 인증키 (API Key or Bearer token)
 *   NHIS_FACILITY_CODE — 요양기관기호 (예: 12345678)
 *
 * 미설정 시 → graceful degradation (NHIS_NOT_CONFIGURED 에러코드 반환)
 *
 * 응답:
 *   200: { grade, copayment_rate, effective_date, raw }
 *   422: { error: 'RRN_MISSING' }       — RRN 미입력
 *   503: { error: 'NHIS_NOT_CONFIGURED' } — 환경변수 미설정
 *   502: { error: 'NHIS_API_ERROR', detail }  — 공단 API 장애/타임아웃
 *   401: { error: 'UNAUTHORIZED' }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FALLBACK_URL = 'https://medicare.nhis.or.kr/portal/refer/selectReferInq.do';

/** NHIS 자격구분코드 → InsuranceGrade 매핑 */
function mapQualificationCode(
  qualCode: string | undefined,
  burdenCode: string | undefined,
): string {
  // 의료급여
  if (qualCode === '3') return 'medical_aid_1';
  if (qualCode === '4') return 'medical_aid_2';
  // 차상위
  if (qualCode === '5') return 'low_income_1';
  if (qualCode === '6') return 'low_income_2';
  // 건강보험 부담구분별 세분
  if (qualCode === '1' || qualCode === '2') {
    if (burdenCode === '6') return 'elderly_flat';  // 65세 정액
    if (burdenCode === '5') return 'infant';         // 영유아 감면
    return 'general';
  }
  // 외국인
  if (qualCode === '9') return 'foreigner';
  return 'unverified';
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

  // 환경변수 확인
  const nhisApiUrl = Deno.env.get('NHIS_API_URL');
  const nhisApiKey = Deno.env.get('NHIS_API_KEY');
  const nhisFacilityCode = Deno.env.get('NHIS_FACILITY_CODE');

  if (!nhisApiUrl || !nhisApiKey || !nhisFacilityCode) {
    return new Response(
      JSON.stringify({
        error: 'NHIS_NOT_CONFIGURED',
        fallback_url: FALLBACK_URL,
        detail: '건보공단 API 환경변수가 설정되지 않았습니다. Supabase Edge Function 환경변수를 확인하세요.',
      }),
      { status: 503, headers: corsHeaders },
    );
  }

  // service role 클라이언트로 RRN 복호화
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
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

  // NHIS Open API 호출
  // 표준 요청 형식: POST JSON { yadmNm, rsdntNo, ...}
  // 응답 형식: { qualCd, burdenCd, copayRate, applyBgngYmd, ... }
  // ※ 실제 NHIS API 스펙에 따라 필드명이 다를 수 있음.
  //   NHIS_API_URL에 올바른 엔드포인트와 NHIS_API_KEY에 인증키를 설정하면 동작.
  let nhisRaw: Record<string, unknown> = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const nhisRes = await fetch(nhisApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nhisApiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        yadmNm: nhisFacilityCode,   // 요양기관기호
        rsdntNo: rrn13,             // 주민등록번호 13자리
        inqDt: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD
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

  // 응답 파싱 — NHIS Open API 표준 필드명 기준
  // 실제 API 스펙 필드명으로 교체 필요 시 아래만 수정
  const qualCode = String(nhisRaw['qualCd'] ?? nhisRaw['qualificationCode'] ?? nhisRaw['자격구분코드'] ?? '');
  const burdenCode = String(nhisRaw['burdenCd'] ?? nhisRaw['burdenCode'] ?? nhisRaw['부담구분코드'] ?? '');
  const rawRate = nhisRaw['copayRate'] ?? nhisRaw['본인부담율'] ?? nhisRaw['copaymentRate'];
  const effectiveDate =
    String(nhisRaw['applyBgngYmd'] ?? nhisRaw['적용개시일'] ?? nhisRaw['effectiveDate'] ?? '').slice(0, 8);

  const grade = mapQualificationCode(qualCode || undefined, burdenCode || undefined);
  const copaymentRate = parseCopayRate(rawRate);

  // effectiveDate YYYYMMDD → YYYY-MM-DD
  const effectiveDateFormatted = effectiveDate.length === 8
    ? `${effectiveDate.slice(0, 4)}-${effectiveDate.slice(4, 6)}-${effectiveDate.slice(6, 8)}`
    : null;

  return new Response(
    JSON.stringify({
      grade,
      copayment_rate: copaymentRate,
      effective_date: effectiveDateFormatted,
      raw: nhisRaw,
    }),
    { status: 200, headers: corsHeaders },
  );
});
