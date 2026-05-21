/**
 * IOcrService — OCR 서비스 인터페이스 추상화
 *
 * T-20260522-foot-RECEIPT-OCR-AUTO Phase 2a
 *
 * 설계 원칙:
 *   - 서비스 교체 가능 설계 (Tesseract.js → Google Vision → AWS Rekognition 등)
 *   - Phase 2a: SupabaseEdgeOcrService (stub), Phase 2b: 실제 OCR API 연동
 *   - recognize() 호출 측에서 AbortController로 10초 타임아웃 제어
 */

// ─────────────────────────────────────────────────────────────
// OCR 파싱 결과
// ─────────────────────────────────────────────────────────────

export interface OcrParsedData {
  /** 결제금액 (원) */
  amount?: number;
  /** 결제수단 */
  method?: 'card' | 'cash' | 'transfer';
  /** 결제일시 (ISO 8601) */
  paidAt?: string;
  /** 카드사 */
  cardCompany?: string;
}

export interface OcrResult {
  /** OCR 인식 원본 텍스트 */
  rawText: string;
  /** 파싱된 구조화 데이터 */
  parsed: OcrParsedData;
  /** 인식 신뢰도 (0~1) — 0이면 인식 실패로 간주 */
  confidence: number;
  /** 사용한 OCR 프로바이더 식별자 */
  provider: string;
}

// ─────────────────────────────────────────────────────────────
// OCR 서비스 인터페이스
// ─────────────────────────────────────────────────────────────

export interface IOcrService {
  /**
   * 이미지 blob을 OCR 인식한다.
   * @param imageBlob - 영수증 이미지 Blob (image/jpeg, image/png, image/webp)
   * @param signal   - AbortController.signal (10초 타임아웃 등 외부에서 제어)
   */
  recognize(imageBlob: Blob, signal?: AbortSignal): Promise<OcrResult>;
}

// ─────────────────────────────────────────────────────────────
// Edge Function API 응답 스키마 (receipt-ocr EF)
// ─────────────────────────────────────────────────────────────

export interface OcrApiResponse {
  ok: boolean;
  rawText: string;
  parsedAmount: number | null;
  parsedMethod: 'card' | 'cash' | 'transfer' | null;
  parsedPaidAt: string | null;
  parsedCardCompany: string | null;
  confidence: number;
  provider: string;
  error?: string;
}
