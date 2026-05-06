/**
 * useDocumentUpload — Supabase Storage 'documents' 버킷 자동 업로드 훅
 *
 * T-20260506-foot-CHECKLIST-AUTOUPLOAD.
 *
 * 경로 컨벤션:
 *   documents/customer/{customerId}/{prefix}_{timestamp}.{ext}
 *
 * - 양식 데이터(JSON) + 서명 PNG + (선택) PDF 를 한 번에 업로드한다.
 * - 업로드 결과는 signedUrl 을 함께 반환해 즉시 미리보기 가능.
 *
 * @see DocumentViewer (조회)
 * @see ChecklistForm / ConsentForm (저장 호출)
 */
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface UploadedDocument {
  /** 'documents' 버킷 내부 경로 */
  path: string;
  /** 1시간 유효 signed URL */
  signedUrl: string | null;
  /** 업로드 시각 (ISO) */
  uploadedAt: string;
}

export interface UploadDocumentInput {
  customerId: string;
  /** 파일명 prefix (예: 'checklist', 'consent_refund', 'consent_non_covered', 'signature') */
  prefix: string;
  /** Blob 또는 base64 dataURL */
  body: Blob | string;
  /** ext (예: 'json', 'png', 'pdf') */
  ext: 'json' | 'png' | 'pdf' | 'jpg';
  /** Content-Type (생략 시 ext에서 추론) */
  contentType?: string;
}

const EXT_TO_TYPE: Record<UploadDocumentInput['ext'], string> = {
  json: 'application/json',
  png: 'image/png',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
};

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function useDocumentUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (input: UploadDocumentInput): Promise<UploadedDocument | null> => {
    setUploading(true);
    setError(null);
    try {
      const ts = Date.now();
      const path = `customer/${input.customerId}/${input.prefix}_${ts}.${input.ext}`;
      const contentType = input.contentType ?? EXT_TO_TYPE[input.ext];

      let body: Blob;
      if (typeof input.body === 'string') {
        if (input.body.startsWith('data:')) {
          body = await dataUrlToBlob(input.body);
        } else {
          // 일반 문자열 → JSON 등 텍스트
          body = new Blob([input.body], { type: contentType });
        }
      } else {
        body = input.body;
      }

      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, body, { contentType, upsert: false });

      if (upErr) {
        setError(upErr.message);
        return null;
      }

      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(path, 3600);

      return {
        path,
        signedUrl: signed?.signedUrl ?? null,
        uploadedAt: new Date(ts).toISOString(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      setError(msg);
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  /** 한 번의 호출로 여러 문서 업로드 (실패 즉시 중단) */
  const uploadMany = useCallback(
    async (inputs: UploadDocumentInput[]): Promise<UploadedDocument[]> => {
      const out: UploadedDocument[] = [];
      for (const inp of inputs) {
        const r = await upload(inp);
        if (!r) return out; // 실패한 부분까지만 반환
        out.push(r);
      }
      return out;
    },
    [upload],
  );

  return { upload, uploadMany, uploading, error };
}
