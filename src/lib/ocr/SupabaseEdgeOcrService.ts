/**
 * SupabaseEdgeOcrService — IOcrService 구현체
 *
 * T-20260522-foot-RECEIPT-OCR-AUTO Phase 2a
 *
 * Supabase Edge Function `receipt-ocr`에 이미지를 multipart/form-data로 전송한다.
 * Phase 2a: Edge Function이 stub 결과를 반환 (confidence=0)
 * Phase 2b: Edge Function 내부에서 실제 OCR API 호출 (Google Vision 등)
 *
 * AbortSignal(10초 타임아웃)은 호출 측(ReceiptUpload)에서 외부 제어.
 */

import { supabase } from '@/lib/supabase';
import type { IOcrService, OcrResult, OcrApiResponse } from './types';

export class SupabaseEdgeOcrService implements IOcrService {
  async recognize(imageBlob: Blob, signal?: AbortSignal): Promise<OcrResult> {
    // multipart/form-data로 이미지 전송
    const formData = new FormData();
    formData.append('image', imageBlob, 'receipt.jpg');

    // Supabase auth 토큰 획득
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    // Supabase functions URL 구성
    const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl
      ?? import.meta.env.VITE_SUPABASE_URL;

    const efUrl = `${supabaseUrl}/functions/v1/receipt-ocr`;

    let response: Response;
    try {
      response = await fetch(efUrl, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
        body: formData,
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error('OCR_TIMEOUT');
      }
      throw new Error(`OCR_NETWORK: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OCR_HTTP_${response.status}: ${text}`);
    }

    const json: OcrApiResponse = await response.json();

    if (!json.ok) {
      throw new Error(`OCR_API: ${json.error ?? 'unknown'}`);
    }

    return {
      rawText: json.rawText ?? '',
      parsed: {
        amount: json.parsedAmount ?? undefined,
        method: json.parsedMethod ?? undefined,
        paidAt: json.parsedPaidAt ?? undefined,
        cardCompany: json.parsedCardCompany ?? undefined,
      },
      confidence: json.confidence,
      provider: json.provider,
    };
  }
}
