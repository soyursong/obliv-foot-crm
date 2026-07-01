/**
 * ReceiptUpload — 영수증 이미지 업로드 + OCR 자동인식 + 수동입력 폴백
 *
 * T-20260512-foot-OCR-RECEIPT (Phase 1): 이미지 업로드 + 수동입력
 * T-20260522-foot-RECEIPT-OCR-AUTO (Phase 2a): OCR 자동인식 UI + 인터페이스 + DB 저장
 *   - IOcrService 추상화 (서비스 교체 가능)
 *   - SupabaseEdgeOcrService (Phase 2a stub → Phase 2b 실제 연동)
 *   - 로딩 인디케이터 + 10초 AbortController 타임아웃
 *   - OCR 결과 프리필 (결제금액·결제수단·카드사·결제일시)
 *   - 인식 실패 시 수동입력 폴백 유지
 *   - OCR 결과 receipt_ocr_results DB 저장
 *
 * 새 npm 패키지 미사용 — 기존 @supabase/supabase-js + lucide-react + sonner만 사용
 */

import { useRef, useState, useCallback } from 'react';
import { Camera, ImagePlus, Loader2, ScanText, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { SupabaseEdgeOcrService } from '@/lib/ocr/SupabaseEdgeOcrService';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface ReceiptExtracted {
  /** 결제금액 (원) */
  amount?: number;
  /** 결제수단 */
  method?: 'card' | 'cash' | 'transfer';
  /** Supabase storage path (receipts 버킷) */
  storagePath?: string;
  // Phase 2a 확장 필드 ─────────────────────────────────────
  /** 결제일시 (ISO 8601) — OCR 인식 시만 */
  paidAt?: string;
  /** 카드사 — OCR 인식 시만 */
  cardCompany?: string;
  /** OCR 원본 텍스트 */
  ocrRawText?: string;
  /** OCR 신뢰도 (0~1) */
  ocrConfidence?: number;
}

type OcrState = 'idle' | 'running' | 'success' | 'fail';

interface Props {
  /** 추출 완료 콜백 — 금액/결제수단 자동기입용 */
  onExtracted: (data: ReceiptExtracted) => void;
  /** 결과 저장용 clinic_id (없으면 DB 저장 스킵) */
  clinicId?: string;
  /** 결과 저장용 check_in_id (optional) */
  checkInId?: string;
  /** 추가 클래스 */
  className?: string;
}

/** OCR 타임아웃 (ms) */
const OCR_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────
// 한국 영수증 regex 파서 (텍스트 붙여넣기 폴백용)
// ─────────────────────────────────────────────────────────────

/**
 * 영수증 텍스트에서 금액과 결제수단을 추출한다.
 *
 * 패턴 예시:
 *   "합계금액 123,456원"  →  amount: 123456
 *   "결제금액: 50,000"    →  amount: 50000
 *   "카드 승인"           →  method: card
 *   "현금영수증"          →  method: cash
 *   "계좌이체"            →  method: transfer
 */
export function parseReceiptText(text: string): ReceiptExtracted {
  const result: ReceiptExtracted = {};

  // ── 금액 추출 ──────────────────────────────────────────────
  const amountPatterns = [
    /(?:합계금액|결제금액|승인금액|거래금액|총\s*금액|합\s*계)\s*[:\s]?\s*([\d,]+)\s*원?/,
    /금\s*액\s*[:\s]\s*([\d,]+)/,
    /^\s*([\d,]{5,})\s*(?:원|₩)?\s*$/m,
  ];

  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) {
        result.amount = n;
        break;
      }
    }
  }

  // ── 결제수단 추출 ───────────────────────────────────────────
  const lower = text;
  if (/카드\s*승인|신용카드|체크카드|카드\s*결제|CARD|card/i.test(lower)) {
    result.method = 'card';
  } else if (/현금\s*영수증|현금\s*결제|현금|CASH|cash/i.test(lower)) {
    result.method = 'cash';
  } else if (/계좌이체|이체|무통장|전자\s*결제|transfer/i.test(lower)) {
    result.method = 'transfer';
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────

export function ReceiptUpload({ onExtracted, clinicId, checkInId, className }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showPastePanel, setShowPastePanel] = useState(false);
  const [ocrState, setOcrState] = useState<OcrState>('idle');
  const [ocrMsg, setOcrMsg] = useState('');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  // ── 이미지 처리 ────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드 가능합니다');
      return;
    }

    // 로컬 프리뷰 (즉시)
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setImageBlob(file);
    setStoragePath(null);
    setOcrState('idle');
    setOcrMsg('');

    // Supabase storage 업로드 시도
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) {
        if (error.message?.includes('not found') || error.message?.includes('bucket')) {
          // 버킷 미생성 상태 — 무음 처리
        } else {
          console.warn('[ReceiptUpload] storage upload failed:', error.message);
        }
      } else {
        setStoragePath(path);
        onExtracted({ storagePath: path });
      }
    } catch (e) {
      console.warn('[ReceiptUpload] storage error:', e);
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  // ── OCR 자동인식 ───────────────────────────────────────────
  const handleOcrRecognize = useCallback(async () => {
    if (!imageBlob) {
      toast.error('이미지를 먼저 업로드하세요');
      return;
    }

    // 기존 진행 중인 OCR 취소
    abortCtrlRef.current?.abort();
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    // 10초 타임아웃
    const timeoutId = setTimeout(() => ctrl.abort(), OCR_TIMEOUT_MS);

    setOcrState('running');
    setOcrMsg('영수증 인식 중…');

    try {
      const service = new SupabaseEdgeOcrService();
      const result = await service.recognize(imageBlob, ctrl.signal);

      clearTimeout(timeoutId);

      if (result.confidence <= 0) {
        // confidence=0 → 인식 실패 (Phase 2a stub 정상 동작)
        setOcrState('fail');
        setOcrMsg('자동 인식 실패. 텍스트를 직접 붙여넣으세요.');
        setShowPastePanel(true);
        toast.warning('OCR 자동 인식 실패 — 텍스트 붙여넣기로 입력해 주세요');

        // DB 저장 (실패 이력)
        await saveOcrResult({
          storagePath: storagePath ?? undefined,
          rawText: result.rawText,
          parsedAmount: null,
          parsedMethod: null,
          parsedPaidAt: null,
          parsedCardCompany: null,
          confidence: 0,
          provider: result.provider,
        });
        return;
      }

      // confidence > 0 → 인식 성공 → 프리필
      const extracted: ReceiptExtracted = {
        storagePath: storagePath ?? undefined,
        amount: result.parsed.amount,
        method: result.parsed.method,
        paidAt: result.parsed.paidAt,
        cardCompany: result.parsed.cardCompany,
        ocrRawText: result.rawText,
        ocrConfidence: result.confidence,
      };

      onExtracted(extracted);
      setOcrState('success');
      setOcrMsg(`인식 완료 (신뢰도 ${Math.round(result.confidence * 100)}%)`);

      const parts: string[] = [];
      if (result.parsed.amount) parts.push(`금액 ${result.parsed.amount.toLocaleString('ko-KR')}원`);
      if (result.parsed.method) parts.push(`결제수단 ${METHOD_LABEL[result.parsed.method]}`);
      if (result.parsed.cardCompany) parts.push(`카드사 ${result.parsed.cardCompany}`);
      toast.success(`OCR 자동기입: ${parts.join(' · ')}`);

      // DB 저장 (성공)
      await saveOcrResult({
        storagePath: storagePath ?? undefined,
        rawText: result.rawText,
        parsedAmount: result.parsed.amount ?? null,
        parsedMethod: result.parsed.method ?? null,
        parsedPaidAt: result.parsed.paidAt ?? null,
        parsedCardCompany: result.parsed.cardCompany ?? null,
        confidence: result.confidence,
        provider: result.provider,
      });

    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = (err as Error).message === 'OCR_TIMEOUT'
        || (err as Error).name === 'AbortError';
      setOcrState('fail');
      setOcrMsg(isTimeout ? '인식 시간 초과 (10초). 텍스트를 직접 붙여넣으세요.' : '인식 오류. 텍스트를 직접 붙여넣으세요.');
      setShowPastePanel(true);
      toast.error(isTimeout ? 'OCR 시간 초과 — 수동 입력으로 전환' : 'OCR 오류 — 수동 입력으로 전환');
    }
  }, [imageBlob, storagePath, onExtracted, clinicId, checkInId]);

  // ── OCR 결과 DB 저장 (non-blocking, non-fatal) ─────────────
  const saveOcrResult = async (data: {
    storagePath?: string;
    rawText: string;
    parsedAmount: number | null;
    parsedMethod: string | null;
    parsedPaidAt: string | null;
    parsedCardCompany: string | null;
    confidence: number;
    provider: string;
  }) => {
    if (!clinicId) return; // clinicId 없으면 저장 스킵
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('receipt_ocr_results').insert({
        clinic_id: clinicId,
        check_in_id: checkInId ?? null,
        storage_path: data.storagePath ?? null,
        raw_text: data.rawText,
        parsed_amount: data.parsedAmount,
        parsed_method: data.parsedMethod,
        parsed_paid_at: data.parsedPaidAt,
        parsed_card_company: data.parsedCardCompany,
        confidence: data.confidence,
        provider: data.provider,
        created_by: user?.id ?? null,
      });
    } catch (e) {
      // non-fatal — DB 저장 실패는 UI 흐름 차단 안 함
      console.warn('[ReceiptUpload] OCR result save failed:', e);
    }
  };

  // ── 텍스트 붙여넣기 파싱 ───────────────────────────────────
  const applyPasteText = () => {
    if (!pasteText.trim()) {
      toast.error('텍스트를 붙여넣기하세요');
      return;
    }
    const extracted = parseReceiptText(pasteText);
    if (!extracted.amount && !extracted.method) {
      toast.warning('금액 또는 결제수단을 인식하지 못했습니다. 직접 입력해 주세요.');
      return;
    }

    onExtracted({ ...extracted, storagePath: storagePath ?? undefined });

    const parts: string[] = [];
    if (extracted.amount) parts.push(`금액 ${extracted.amount.toLocaleString('ko-KR')}원`);
    if (extracted.method) parts.push(`결제수단 ${METHOD_LABEL[extracted.method]}`);
    toast.success(`자동기입: ${parts.join(' · ')}`);
  };

  // ── 초기화 ────────────────────────────────────────────────
  const clear = () => {
    abortCtrlRef.current?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImageBlob(null);
    setStoragePath(null);
    setPasteText('');
    setShowPastePanel(false);
    setOcrState('idle');
    setOcrMsg('');
  };

  // ── OCR 버튼 상태 ─────────────────────────────────────────
  const ocrBtnDisabled = !previewUrl || uploading || ocrState === 'running';

  return (
    <div className={cn('space-y-2', className)}>
      <Label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ScanText className="h-3.5 w-3.5" />
        영수증 업로드
        <span className="font-normal text-[10px] text-muted-foreground/70">(선택)</span>
      </Label>

      {!previewUrl ? (
        /* ── 업로드 영역 ─────────────────────────────────── */
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-teal-300 bg-teal-50/50 py-3 text-sm font-medium text-teal-700 hover:bg-teal-50 transition"
          >
            <Camera className="h-4 w-4" />
            촬영
          </button>
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
          >
            <ImagePlus className="h-4 w-4" />
            갤러리
          </button>
        </div>
      ) : (
        /* ── 프리뷰 영역 ─────────────────────────────────── */
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt="영수증 미리보기"
            className="max-h-36 w-auto rounded-lg border object-contain shadow-sm"
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 text-xs text-white">
              저장 중…
            </div>
          )}
          {storagePath && (
            <div className="absolute bottom-1 right-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] text-white">
              저장됨
            </div>
          )}
          <button
            type="button"
            onClick={clear}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow"
            title="삭제"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ── OCR 자동인식 버튼 (Phase 2a: 활성화) ─────────── */}
      {previewUrl && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ocrBtnDisabled}
              onClick={handleOcrRecognize}
              data-testid="btn-ocr-recognize"
              className={cn(
                'gap-1 text-xs',
                ocrState === 'success' && 'border-emerald-500 text-emerald-700',
                ocrState === 'fail' && 'border-amber-400 text-amber-700',
              )}
            >
              {ocrState === 'running' ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  인식 중…
                </>
              ) : (
                <>
                  <ScanText className="h-3 w-3" />
                  OCR 자동인식
                </>
              )}
            </Button>

            {/* 상태 메시지 */}
            {ocrMsg && (
              <span
                className={cn(
                  'text-[11px]',
                  ocrState === 'success' ? 'text-emerald-600' : 'text-amber-600',
                )}
              >
                {ocrMsg}
              </span>
            )}

            {/* idle 힌트 */}
            {ocrState === 'idle' && (
              <span className="text-[11px] text-muted-foreground">
                버튼을 눌러 자동 인식
              </span>
            )}
          </div>

        </div>
      )}

      {/* ── 텍스트 붙여넣기 파싱 패널 ────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowPastePanel(v => !v)}
          className="text-xs text-teal-600 hover:underline"
        >
          {showPastePanel ? '▲ 텍스트 파싱 닫기' : '▼ 영수증 텍스트 붙여넣기로 자동기입'}
        </button>

        {showPastePanel && (
          <div className="mt-2 space-y-2 rounded-lg border bg-slate-50 p-3">
            <Textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={'예) 카드 승인\n합계금액 123,456원\n신용카드 결제'}
              rows={4}
              className="text-xs font-mono"
              data-testid="textarea-receipt-paste"
            />
            <Button
              type="button"
              size="sm"
              onClick={applyPasteText}
              data-testid="btn-paste-apply"
              className="w-full gap-1"
            >
              <ScanText className="h-3.5 w-3.5" />
              금액·결제수단 자동기입
            </Button>
          </div>
        )}
      </div>

      {/* hidden inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleInputChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInputChange}
        data-testid="input-receipt-file"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
};
