/**
 * health-q-photo-sign — T-20260731-foot-FOOTQST-PHOTO-UPLOAD (Pattern B: signed upload URL 발급)
 *
 * 발건강질문지(/health-q/:token) 고객이 발/발톱 사진을 첨부할 때, anon 클라이언트가
 * Storage 버킷에 **직접 GRANT 없이** 업로드할 수 있도록 token-경로 한정 signed upload URL 을
 * 발급하는 전용 EF.
 *
 * ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-135832-y3x7 (a-HARD 조건).
 *   anon 에 Storage 버킷 INSERT 직접 GRANT 금지(7/03 anon-PHI 누출사고와 동일클래스).
 *   Pattern B = anon → 이 EF(service_role, token 검증) → token-경로 한정 signed upload URL 발급
 *              → 그 URL 로만 업로드(uploadToSignedUrl). 제출 RPC(fn_health_q_submit)가 result 연관.
 *   불변식: anon 은 Storage/PHI 직접 무접촉. 경로 = health-q/{clinic_id}/{token}/{uuid}.{ext}.
 *
 * ── Auth ────────────────────────────────────────────────────────
 *   게이트웨이 verify_jwt=false. 실 인증 = 요청 body 의 token 을 EF 가 service_role 로 검증
 *   (health_q_tokens: used_at NULL + expires_at > now()). 유효토큰 보유자만 서명 URL 획득.
 *
 * ── Method ──────────────────────────────────────────────────────
 *   POST { token, files: [{ content_type, byte_size }] }
 *
 * ── Response ────────────────────────────────────────────────────
 *   200: { ok: true, bucket, uploads: [{ path, signed_url, upload_token, content_type }] }
 *   400: { ok: false, error }  (INVALID_PARAM / token_not_found / already_used / token_expired /
 *                               unsupported_type / too_large / too_many)
 *   405 / 500
 *
 * ── 최소권한 ────────────────────────────────────────────────────
 *   - health_q_tokens SELECT(토큰 검증) + Storage createSignedUploadUrl 만.
 *   - 임의 path 선택 불가(경로는 검증된 token/clinic_id 로 EF 가 구성).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'foot-health-q-photos';
const MAX_FILES = 10;
const MAX_BYTES = 15 * 1024 * 1024; // 15MB/장

// content_type → 확장자 화이트리스트 (이미지 only)
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  let payload: { token?: string; files?: Array<{ content_type?: string; byte_size?: number }> };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'INVALID_PARAM', detail: 'body must be JSON' }, 400);
  }

  const token = (payload.token ?? '').trim();
  const files = Array.isArray(payload.files) ? payload.files : [];

  if (!token) return json({ ok: false, error: 'INVALID_PARAM', detail: 'token required' }, 400);
  if (files.length === 0) return json({ ok: false, error: 'INVALID_PARAM', detail: 'files required' }, 400);
  if (files.length > MAX_FILES) return json({ ok: false, error: 'too_many', detail: `max ${MAX_FILES}` }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('CRM_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ── 1) 토큰 검증 (service_role) ──────────────────────────────────────────
    const { data: tok, error: tokErr } = await admin
      .from('health_q_tokens')
      .select('id, clinic_id, used_at, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (tokErr) return json({ ok: false, error: 'INTERNAL', detail: tokErr.message }, 500);
    if (!tok) return json({ ok: false, error: 'token_not_found' }, 400);
    if (tok.used_at) return json({ ok: false, error: 'already_used' }, 400);
    if (new Date(tok.expires_at as string) < new Date()) return json({ ok: false, error: 'token_expired' }, 400);

    // ── 2) 파일 검증 + 경로 구성 + signed upload URL 발급 ────────────────────
    //   경로 = health-q/{clinic_id}/{token}/{uuid}.{ext}  (anon 이 path 선택 불가)
    const uploads: Array<{ path: string; signed_url: string; upload_token: string; content_type: string }> = [];

    for (const f of files) {
      const ct = (f.content_type ?? '').toLowerCase();
      const ext = EXT_BY_TYPE[ct];
      if (!ext) return json({ ok: false, error: 'unsupported_type', detail: ct }, 400);
      if (typeof f.byte_size === 'number' && f.byte_size > MAX_BYTES) {
        return json({ ok: false, error: 'too_large', detail: `max ${MAX_BYTES} bytes` }, 400);
      }

      const path = `health-q/${tok.clinic_id}/${token}/${crypto.randomUUID()}.${ext}`;
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);

      if (signErr || !signed) {
        return json({ ok: false, error: 'INTERNAL', detail: signErr?.message ?? 'sign failed' }, 500);
      }

      uploads.push({
        path,
        signed_url: signed.signedUrl,
        upload_token: signed.token,
        content_type: ct,
      });
    }

    return json({ ok: true, bucket: BUCKET, uploads });
  } catch (e) {
    return json({ ok: false, error: 'INTERNAL', detail: (e as Error).message }, 500);
  }
});
