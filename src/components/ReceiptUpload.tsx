/**
 * ReceiptUpload — 영수증 이미지 업로드 + 금액/결제수단 추출 (T-20260512-foot-OCR-RECEIPT)
 *
 * Phase 1: 이미지 업로드 + Supabase storage + regex 텍스트 파싱
 * Phase 2 stub: OCR 자동인식 버튼 (연동 대기)
 *
 * 새 npm 패키지 미사용 — 기존 @supabase/supabase-js + lucide-react + sonner만 사용
 */

import { useRef, useState } from 'react';
import { Camera, ImagePlus, ScanText, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface ReceiptExtracted {
  amount?: number;
  method?: 'card' | 'cash' | 'transfer';
  /** Supabase storage path (receipts 버킷) — 저장 성공 시 */
  storagePath?: string;
}

interface Props {
  /** 추출 완료 콜백 — 금액/결제수단 자동기입용 */
  onExtracted: (data: ReceiptExtracted) => void;
  /** 추가 클래스 */
  className?: string;
}

// ─────────────────────────────────────────────────────────────
// 한국 영수증 regex 파서
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
  // 우선순위: 합계/결제금액 > 승인금액 > 단독 금액
  const amountPatterns = [
    // "합계금액: 123,456원" / "합  계  123456"
    /(?:합계금액|결제금액|승인금액|거래금액|총\s*금액|합\s*계)\s*[:\s]?\s*([\d,]+)\s*원?/,
    // "금액 123,456"
    /금\s*액\s*[:\s]\s*([\d,]+)/,
    // 독립 숫자(5자리 이상, 단독 줄) — 최후 수단
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
  if (
    /카드\s*승인|신용카드|체크카드|카드\s*결제|CARD|card/i.test(lower)
  ) {
    result.method = 'card';
  } else if (
    /현금\s*영수증|현금\s*결제|현금|CASH|cash/i.test(lower)
  ) {
    result.method = 'cash';
  } else if (
    /계좌이체|이체|무통장|전자\s*결제|transfer/i.test(lower)
  ) {
    result.method = 'transfer';
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────

export function ReceiptUpload({ onExtracted, className }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showPastePanel, setShowPastePanel] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // ── 이미지 처리 ────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드 가능합니다');
      return;
    }

    // 로컬 프리뷰 (즉시)
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setStoragePath(null);

    // Supabase storage 업로드 시도
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) {
        // 버킷이 없거나 권한 없는 경우 — 로컬 프리뷰만 사용 (무음 처리)
        if (error.message?.includes('not found') || error.message?.includes('bucket')) {
          // 버킷 미생성 상태 — Phase 2에서 migration 예정
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
    // 같은 파일 재선택 허용
    e.target.value = '';
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
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStoragePath(null);
    setPasteText('');
    setShowPastePanel(false);
  };

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
          {/* 카메라 촬영 */}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-teal-300 bg-teal-50/50 py-3 text-sm font-medium text-teal-700 hover:bg-teal-50 transition"
          >
            <Camera className="h-4 w-4" />
            촬영
          </button>

          {/* 갤러리 선택 */}
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

      {/* ── OCR Phase 2 버튼 (stub) ──────────────────────────── */}
      {previewUrl && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="gap-1 text-xs opacity-60"
            title="Phase 2 — OCR API 연동 예정 (API 키 확보 후 활성화)"
          >
            <ScanText className="h-3 w-3" />
            OCR 자동인식
            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">준비 중</span>
          </Button>
          <span className="text-[11px] text-muted-foreground">
            아래 텍스트 붙여넣기로 자동기입 가능
          </span>
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
            <p className="text-[11px] text-muted-foreground">
              영수증 앱/카메라 OCR 결과 텍스트를 붙여넣으면 금액·결제수단을 자동으로 인식합니다.
            </p>
            <Textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={'예) 카드 승인\n합계금액 123,456원\n신용카드 결제'}
              rows={4}
              className="text-xs font-mono"
            />
            <Button
              type="button"
              size="sm"
              onClick={applyPasteText}
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
