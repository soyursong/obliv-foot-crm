/**
 * receipt-ocr — 영수증 OCR 처리 Edge Function
 *
 * T-20260522-foot-RECEIPT-OCR-AUTO
 *
 * ── Phase 2a (현재): stub 모드 ──────────────────────────────────────────
 *   - 이미지를 수신·로깅하고 confidence=0 결과 반환
 *   - UI: "인식 실패 → 수동 입력" 폴백 경로 검증용
 *
 * ── Phase 2b (OCR 서비스 확정 후): ──────────────────────────────────────
 *   - OCR_PROVIDER secret 추가 ('google_vision' | 'aws_rekognition' | 'clova')
 *   - processOcrWithProvider() 구현 교체 (provider 분기)
 *   - confidence > 0 결과로 프리필 활성화
 *
 * POST /functions/v1/receipt-ocr
 * Content-Type: multipart/form-data
 * Body: image (Blob)
 *
 * Response (OcrApiResponse):
 *   { ok, rawText, parsedAmount, parsedMethod, parsedPaidAt, parsedCardCompany, confidence, provider }
 *
 * Edge Secrets (Phase 2b):
 *   OCR_PROVIDER         — 사용할 OCR 서비스 ('google_vision' | 'aws_rekognition')
 *   GOOGLE_VISION_KEY    — Google Cloud Vision API Key
 *   AWS_ACCESS_KEY_ID    — (AWS Rekognition 선택 시)
 *   AWS_SECRET_ACCESS_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// ─────────────────────────────────────────────────────────────
// 한국 영수증 regex 파서 (rawText → 구조화 데이터)
// Phase 2b에서 실제 OCR text가 오면 이 파서가 의미를 갖는다.
// ─────────────────────────────────────────────────────────────

function parseReceiptText(text: string): {
  parsedAmount: number | null;
  parsedMethod: 'card' | 'cash' | 'transfer' | null;
  parsedPaidAt: string | null;
  parsedCardCompany: string | null;
} {
  let parsedAmount: number | null = null;
  let parsedMethod: 'card' | 'cash' | 'transfer' | null = null;
  let parsedPaidAt: string | null = null;
  let parsedCardCompany: string | null = null;

  if (!text.trim()) {
    return { parsedAmount, parsedMethod, parsedPaidAt, parsedCardCompany };
  }

  // ── 금액 ──────────────────────────────────────────────────
  const amountPatterns = [
    /(?:합계금액|결제금액|승인금액|거래금액|총\s*금액|합\s*계)\s*[:\s]?\s*([\d,]+)\s*원?/,
    /금\s*액\s*[:\s]\s*([\d,]+)/,
    /^\s*([\d,]{5,})\s*(?:원|₩)?\s*$/m,
  ];
  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) { parsedAmount = n; break; }
    }
  }

  // ── 결제수단 ───────────────────────────────────────────────
  if (/카드\s*승인|신용카드|체크카드|카드\s*결제|CARD/i.test(text)) {
    parsedMethod = 'card';
  } else if (/현금\s*영수증|현금\s*결제|현금|CASH/i.test(text)) {
    parsedMethod = 'cash';
  } else if (/계좌이체|이체|무통장|전자\s*결제/i.test(text)) {
    parsedMethod = 'transfer';
  }

  // ── 결제일시 (YYYY.MM.DD HH:MM 또는 YYYY-MM-DD HH:MM) ──────
  const dateMatch = text.match(
    /(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (dateMatch) {
    const [, yr, mo, dy, hh, mm, ss] = dateMatch;
    parsedPaidAt = `${yr}-${mo}-${dy}T${hh}:${mm}:${ss ?? '00'}+09:00`;
  }

  // ── 카드사 ─────────────────────────────────────────────────
  const cardCompanyPatterns = [
    '신한', '국민', '하나', '우리', '삼성', '롯데', '현대', 'BC', 'NH', '농협', 'IBK', '기업',
    '카카오', '토스', '씨티', 'Citi', '외환', '제주', 'KDB', '산업',
  ];
  for (const cc of cardCompanyPatterns) {
    if (text.includes(cc)) { parsedCardCompany = cc; break; }
  }

  return { parsedAmount, parsedMethod, parsedPaidAt, parsedCardCompany };
}

// ─────────────────────────────────────────────────────────────
// Phase 2a stub: 이미지 수신 → confidence=0 반환
// Phase 2b: 이 함수를 실제 OCR API 호출로 교체
// ─────────────────────────────────────────────────────────────

async function processOcr(_imageBlob: Blob): Promise<{
  rawText: string;
  confidence: number;
  provider: string;
}> {
  // Phase 2a stub — 이미지 수신 확인만. 실제 OCR 미수행.
  // Phase 2b: OCR_PROVIDER secret 확인 후 분기
  //
  // const provider = Deno.env.get('OCR_PROVIDER') ?? 'stub';
  // if (provider === 'google_vision') { ... }
  // if (provider === 'aws_rekognition') { ... }

  return {
    rawText: '',       // Phase 2a: 빈 텍스트 (실제 OCR 없음)
    confidence: 0,     // Phase 2a: confidence=0 → UI에서 수동입력 폴백 트리거
    provider: 'tesseract_stub',
  };
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }),
      { status: 405, headers: CORS },
    );
  }

  // ── JWT 인증 ─────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }),
      { status: 401, headers: CORS },
    );
  }

  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(sbUrl, sbAnon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }),
      { status: 401, headers: CORS },
    );
  }

  // ── 이미지 추출 ──────────────────────────────────────────
  let imageBlob: Blob;
  try {
    const formData = await req.formData();
    const imageField = formData.get('image');
    if (!imageField || !(imageField instanceof File)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'MISSING_IMAGE' }),
        { status: 400, headers: CORS },
      );
    }
    imageBlob = imageField as Blob;
  } catch (_e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'INVALID_FORM_DATA' }),
      { status: 400, headers: CORS },
    );
  }

  // ── OCR 처리 ─────────────────────────────────────────────
  let ocrOut: { rawText: string; confidence: number; provider: string };
  try {
    ocrOut = await processOcr(imageBlob);
  } catch (e) {
    console.error('[receipt-ocr] OCR processing error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'OCR_FAILED', detail: String(e) }),
      { status: 500, headers: CORS },
    );
  }

  // ── 텍스트 파싱 ──────────────────────────────────────────
  const parsed = parseReceiptText(ocrOut.rawText);

  const result = {
    ok: true,
    rawText: ocrOut.rawText,
    parsedAmount: parsed.parsedAmount,
    parsedMethod: parsed.parsedMethod,
    parsedPaidAt: parsed.parsedPaidAt,
    parsedCardCompany: parsed.parsedCardCompany,
    confidence: ocrOut.confidence,
    provider: ocrOut.provider,
  };

  console.log(`[receipt-ocr] user=${user.id} provider=${ocrOut.provider} confidence=${ocrOut.confidence}`);

  return new Response(JSON.stringify(result), { status: 200, headers: CORS });
});
