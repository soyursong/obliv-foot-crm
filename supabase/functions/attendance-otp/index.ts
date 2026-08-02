// attendance-otp — foot(obliv-foot-crm) 직원 QR 출퇴근 OTP EF
// T-20260802-foot-ATTENDANCE-QR-PORT (롱레 happy-flow-queue 원본 어댑트 이식).
//
// anon invoke(공개 punch 페이지에서 호출) / 내부 service_role 단일창구.
//   staff.phone SELECT·OTP write·punch write 는 anon 직접 접근 불가 → 전부 EF(service_role) 경유.
//   ⚠ verify_jwt=false 선결(config.toml) — 비로그인 punch 를 받으므로 게이트웨이 JWT 검사 OFF 필수.
//     (scalp2 cron paused verify_jwt 401 함정 사전 차단).
//
// 액션(SMS-OTP):
//   action=qr_token : 키오스크(태블릿)가 60초 회전 QR 토큰 요청 (PII 0).
//                     인증 = 유효 kiosk_token(body.k, Vault attendance_kiosk_token_<slug>) OR admin JWT.
//   action=send     : QR 토큰 신선도 검증 → phone↔staff 대조 → OTP 생성·저장·발송(솔라피).
//   action=verify   : OTP 검증(만료 3분·시도캡 5회) → attendance_punch insert + read-time 리컨사일.
//
// 액션(기기 바인딩):
//   action=enroll_request : QR 신선도 검증 → device_token(256bit) 발급 → hash만 pending 저장 → 폰에 raw 반환.
//   action=enroll_status  : device_id 로 승인 상태 폴링(pending/active/revoked).
//   action=punch_device   : QR 신선도 검증 → device_token hash 대조 → active 기기 staff 출근(원탭).
//
// ★foot 어댑트: 리컨사일 타깃 B(staff_attendance) — punch RPC 는 raw 사실만 저장, verdict 는
//   fn_attendance_verdict 로 read-time 파생(mutable 저장 컬럼 0, DA no-NULL-flip). shift 참조 없음.
// ⚠ QR/OTP HMAC 키 = Vault(get_vault_secret, attendance_* 화이트리스트). 평문 하드코딩 0.
//
// Env: SUPABASE_URL, CRM_SERVICE_ROLE_KEY | SUPABASE_SECRET_KEYS | SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// deno-lint-ignore no-explicit-any
declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const CODE_RE = /^\d{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_TOKEN_RE = /^[0-9a-f]{64}$/;      // 서버 발급 256bit hex
const ENROLL_WINDOW_MS = 10 * 60_000;
const ENROLL_WINDOW_CAP = 20;
const QR_BUCKET_MS = 60_000;          // 60초 회전
const QR_SIG_LEN = 32;
const OTP_TTL_MS = 3 * 60_000;        // 만료 3분
const OTP_MAX_ATTEMPTS = 5;           // 시도캡 5회
const OTP_RESEND_COOLDOWN_MS = 45_000;
const OTP_SEND_WINDOW_MS = 10 * 60_000;
const OTP_SEND_WINDOW_CAP = 5;

// ── HMAC-SHA256 (Solapi 인증 + QR/OTP 서명 공용) ─────────────────
async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomToken256(): string {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── KR E.164 → domestic(010…) 환원 (솔라피 발송용) ──────────────
function normalizeKrPhone(p: string): string {
  let d = (p ?? "").replace(/[^0-9]/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return d;
}

// ── Solapi 발송 (SMS/LMS) ─────────
async function sendSolapi(params: {
  apiKey: string; apiSecret: string; senderNumber: string; recipientPhone: string; body: string;
}): Promise<{ success: boolean; messageId: string | null; errorMessage: string | null }> {
  const { apiKey, apiSecret, senderNumber, recipientPhone, body } = params;
  const msg = {
    to: normalizeKrPhone(recipientPhone),
    from: normalizeKrPhone(senderNumber),
    text: body,
    type: body.length > 60 ? "LMS" : "SMS",
  };
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = await hmacSha256(`${date}${salt}`, apiSecret);
  const authHdr = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  try {
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": authHdr },
      body: JSON.stringify({ message: msg }),
    });
    const rb = await res.json();
    if (res.ok && (rb?.messageId || rb?.groupInfo?.count?.total > 0)) {
      return { success: true, messageId: rb?.messageId ?? rb?.groupInfo?.groupId ?? null, errorMessage: null };
    }
    return { success: false, messageId: null, errorMessage: JSON.stringify(rb?.errorMessage ?? rb) };
  } catch (e) {
    return { success: false, messageId: null, errorMessage: `network: ${String(e)}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY =
    Deno.env.get("CRM_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEYS") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, reason: "server_env_missing" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, reason: "bad_json" }); }

  const action = String(body.action ?? "").trim();
  const slug = String(body.slug ?? body.c ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return json(400, { ok: false, reason: "invalid_slug" });

  // ── clinic 해석 (slug → id) ──
  const { data: clinic } = await admin
    .from("clinics").select("id, open_time").eq("slug", slug).maybeSingle();
  if (!clinic?.id) return json(404, { ok: false, reason: "clinic_not_found" });
  const clinicId = clinic.id as string;

  // ── Vault 키 ──
  async function vaultKey(name: string): Promise<string | null> {
    const { data, error } = await admin.rpc("get_vault_secret", { p_name: name });
    if (error) { console.error("[attendance-otp] vault error", name, error.message); return null; }
    return (data as string | null) ?? null;
  }

  // ── QR 토큰 서명/검증 (HMAC(clinic_id:bucket, qrKey)) ──
  async function signToken(qrKey: string, bucket: number): Promise<string> {
    const sig = (await hmacSha256(`${clinicId}:${bucket}`, qrKey)).slice(0, QR_SIG_LEN);
    return `${bucket}.${sig}`;
  }
  async function verifyToken(qrKey: string, token: string): Promise<boolean> {
    const m = /^(\d+)\.([0-9a-f]+)$/.exec(token ?? "");
    if (!m) return false;
    const bucket = parseInt(m[1], 10);
    const now = Math.floor(Date.now() / QR_BUCKET_MS);
    if (bucket !== now && bucket !== now - 1) return false;
    const expect = (await hmacSha256(`${clinicId}:${bucket}`, qrKey)).slice(0, QR_SIG_LEN);
    if (expect.length !== m[2].length) return false;
    let diff = 0;
    for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ m[2].charCodeAt(i);
    return diff === 0;
  }

  // ── read-time verdict 파생(저장 안 함) — 응답 표시용 ──
  async function verdictFor(staffId: string, workDate: string): Promise<string | null> {
    const { data } = await admin.rpc("fn_attendance_verdict", {
      p_clinic_id: clinicId, p_staff_id: staffId, p_work_date: workDate,
    });
    return (data as string | null) ?? null;
  }

  try {
    // ══════════════════════════════════════════════════════════════
    // action=qr_token — 키오스크 회전 QR 토큰 발급 (PII 0)
    // ══════════════════════════════════════════════════════════════
    if (action === "qr_token") {
      let authorized = false;

      // [A] 키오스크 전용 비밀 토큰 (로그인 불요). URL param k → body.k.
      const kioskToken = String(body.k ?? body.kiosk_token ?? "").trim();
      if (kioskToken) {
        const expected = await vaultKey(`attendance_kiosk_token_${slug}`);
        if (expected && constantTimeEq(kioskToken, expected)) authorized = true;
      }

      // [B] 관리자 로그인(admin JWT). anon apikey 는 getUser 로 거부됨.
      if (!authorized) {
        const authz = req.headers.get("Authorization") ?? "";
        const jwt = authz.replace(/^[Bb]earer\s+/, "").trim();
        if (jwt) {
          const { data: authData, error: authErr } = await admin.auth.getUser(jwt);
          const uid = authData?.user?.id;
          if (!authErr && uid) {
            const { data: prof } = await admin
              .from("user_profiles").select("role").eq("id", uid).maybeSingle();
            const urole = (prof as { role: string } | null)?.role ?? "";
            if (["admin", "manager", "director"].includes(urole)) authorized = true;
          }
        }
      }

      if (!authorized) return json(401, { ok: false, reason: "auth_required" });

      const qrKey = await vaultKey("attendance_qr_hmac_key");
      if (!qrKey) return json(500, { ok: false, reason: "qr_key_missing" });
      const bucket = Math.floor(Date.now() / QR_BUCKET_MS);
      const token = await signToken(qrKey, bucket);
      return json(200, { ok: true, token, ttl_ms: QR_BUCKET_MS });
    }

    // ── 공통: 출근 기록(dup-aware) — 기기 바인딩 punch_device 전용.
    async function doPunchIn(staffId: string, token: string): Promise<Response> {
      const kstWorkDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const { data: existingIn } = await admin
        .from("attendance_punch").select("punch_at")
        .eq("clinic_id", clinicId).eq("staff_id", staffId)
        .eq("work_date", kstWorkDate).eq("punch_type", "in")
        .order("punch_at", { ascending: true }).limit(1).maybeSingle();
      if ((existingIn as { punch_at: string } | null)?.punch_at) {
        return json(200, {
          ok: false, reason: "already_checked_in", punch_type: "in",
          punch_at: (existingIn as { punch_at: string }).punch_at, work_date: kstWorkDate,
          attendance_status: await verdictFor(staffId, kstWorkDate),
        });
      }
      const qrTokenHash = await sha256Hex(token);
      const { data: punch, error: punchErr } = await admin.rpc("fn_attendance_record_punch", {
        p_clinic_id: clinicId, p_staff_id: staffId, p_punch_type: "in",
        p_qr_token_hash: qrTokenHash, p_phone_verified: true, p_method: "qr_device",
      });
      if (punchErr) return json(500, { ok: false, reason: `punch_failed:${punchErr.message}` });
      const p = (punch ?? {}) as Record<string, unknown>;
      return json(200, {
        ok: true, punch_type: "in",
        punch_at: p.punch_at ?? null, work_date: p.work_date ?? null,
        attendance_status: p.attendance_status ?? null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // action=enroll_request — QR 신선도 → device_token 발급(hash만 pending 저장) → 폰에 raw 반환
    // ══════════════════════════════════════════════════════════════
    if (action === "enroll_request") {
      const token = String(body.token ?? body.t ?? "").trim();
      const claimedName = String(body.name ?? "").trim().slice(0, 40);
      const deviceLabel = String(body.device_label ?? "").trim().slice(0, 160);

      const qrKey = await vaultKey("attendance_qr_hmac_key");
      if (!qrKey) return json(500, { ok: false, reason: "qr_key_missing" });
      if (!(await verifyToken(qrKey, token))) return json(401, { ok: false, reason: "qr_token_stale" });
      if (claimedName.length < 1) return json(400, { ok: false, reason: "name_required" });

      const { data: recent } = await admin
        .from("attendance_device").select("id")
        .eq("clinic_id", clinicId).eq("status", "pending")
        .gte("created_at", new Date(Date.now() - ENROLL_WINDOW_MS).toISOString());
      if (((recent as unknown[] | null)?.length ?? 0) >= ENROLL_WINDOW_CAP) {
        return json(429, { ok: false, reason: "rate_limited" });
      }

      const deviceKey = await vaultKey("attendance_device_hmac_key");
      if (!deviceKey) return json(500, { ok: false, reason: "device_key_missing" });
      const deviceToken = randomToken256();
      const deviceTokenHash = await hmacSha256(deviceToken, deviceKey);

      const { data: ins, error: insErr } = await admin
        .from("attendance_device")
        .insert({
          clinic_id: clinicId, claimed_name: claimedName,
          device_token_hash: deviceTokenHash, device_label: deviceLabel || null, status: "pending",
        })
        .select("id").single();
      if (insErr || !ins) return json(500, { ok: false, reason: `enroll_failed:${insErr?.message ?? "?"}` });

      await admin.from("attendance_audit").insert({
        clinic_id: clinicId, action: "device_enroll_request", detail: claimedName,
      });

      return json(200, { ok: true, device_id: (ins as { id: string }).id, device_token: deviceToken });
    }

    // ══════════════════════════════════════════════════════════════
    // action=enroll_status — 기기 승인 상태 폴링
    // ══════════════════════════════════════════════════════════════
    if (action === "enroll_status") {
      const deviceId = String(body.device_id ?? "").trim();
      if (!UUID_RE.test(deviceId)) return json(400, { ok: false, reason: "invalid_device" });
      const { data: dev } = await admin
        .from("attendance_device").select("status")
        .eq("id", deviceId).eq("clinic_id", clinicId).maybeSingle();
      if (!dev) return json(404, { ok: false, reason: "device_not_found" });
      return json(200, { ok: true, status: (dev as { status: string }).status });
    }

    // ══════════════════════════════════════════════════════════════
    // action=punch_device — QR 신선도 → device_token hash 대조 → active 기기 staff 출근(원탭)
    // ══════════════════════════════════════════════════════════════
    if (action === "punch_device") {
      const token = String(body.token ?? body.t ?? "").trim();
      const deviceToken = String(body.device_token ?? "").trim();

      const qrKey = await vaultKey("attendance_qr_hmac_key");
      if (!qrKey) return json(500, { ok: false, reason: "qr_key_missing" });
      if (!(await verifyToken(qrKey, token))) return json(401, { ok: false, reason: "qr_token_stale" });
      if (!DEVICE_TOKEN_RE.test(deviceToken)) return json(400, { ok: false, reason: "invalid_device_token" });

      const deviceKey = await vaultKey("attendance_device_hmac_key");
      if (!deviceKey) return json(500, { ok: false, reason: "device_key_missing" });
      const h = await hmacSha256(deviceToken, deviceKey);

      const { data: dev } = await admin
        .from("attendance_device").select("id, staff_id, status")
        .eq("clinic_id", clinicId).eq("device_token_hash", h).maybeSingle();
      const devRow = dev as { id: string; staff_id: string | null; status: string } | null;
      if (!devRow) return json(404, { ok: false, reason: "device_not_registered" });
      if (devRow.status === "pending") return json(200, { ok: false, reason: "device_pending" });
      if (devRow.status !== "active" || !devRow.staff_id) {
        return json(403, { ok: false, reason: "device_revoked" });
      }

      const res = await doPunchIn(devRow.staff_id, token);
      await admin.from("attendance_device").update({ last_used_at: new Date().toISOString() }).eq("id", devRow.id);
      return res;
    }

    // 공통: phone 정규화(normalize_phone RPC — set_staff_phone 저장값과 동일 규칙)
    async function normPhone(raw: string): Promise<string | null> {
      const { data } = await admin.rpc("normalize_phone", { p_phone: raw });
      const v = (data as string | null) ?? null;
      // normalize_phone 는 변환 불가 시 원본 반환 → E.164(+82) 아니면 무효 취급
      return v && /^\+82/.test(v) ? v : null;
    }

    // ══════════════════════════════════════════════════════════════
    // action=send — QR 신선도 → phone↔staff 대조 → OTP 생성·저장·발송
    // ══════════════════════════════════════════════════════════════
    if (action === "send") {
      const token = String(body.token ?? body.t ?? "").trim();
      const rawPhone = String(body.phone ?? "").trim();

      const qrKey = await vaultKey("attendance_qr_hmac_key");
      if (!qrKey) return json(500, { ok: false, reason: "qr_key_missing" });
      if (!(await verifyToken(qrKey, token))) return json(401, { ok: false, reason: "qr_token_stale" });

      const phone = await normPhone(rawPhone);
      if (!phone) return json(400, { ok: false, reason: "invalid_phone" });

      const { data: staff } = await admin
        .from("staff").select("id")
        .eq("clinic_id", clinicId).eq("phone", phone).eq("active", true).maybeSingle();
      if (!staff?.id) {
        return json(404, { ok: false, reason: "phone_not_registered" });
      }
      const staffId = staff.id as string;

      const { data: recent } = await admin
        .from("attendance_otp").select("created_at")
        .eq("clinic_id", clinicId).eq("phone", phone)
        .gte("created_at", new Date(Date.now() - OTP_SEND_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false });
      const rows = (recent ?? []) as Array<{ created_at: string }>;
      if (rows.length >= OTP_SEND_WINDOW_CAP) return json(429, { ok: false, reason: "rate_limited" });
      if (rows.length > 0 && Date.now() - new Date(rows[0].created_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
        return json(429, { ok: false, reason: "resend_cooldown" });
      }

      const otpKey = await vaultKey("attendance_otp_hmac_key");
      if (!otpKey) return json(500, { ok: false, reason: "otp_key_missing" });

      const code = String(Math.floor(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)));
      const codeHash = await hmacSha256(`${code}:${phone}`, otpKey);
      const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

      const { error: insErr } = await admin.from("attendance_otp").insert({
        clinic_id: clinicId, staff_id: staffId, phone,
        code_hash: codeHash, expires_at: expiresAt, attempts: 0,
      });
      if (insErr) return json(500, { ok: false, reason: `otp_store_failed:${insErr.message}` });

      await admin.from("attendance_audit").insert({
        clinic_id: clinicId, staff_id: staffId, phone, action: "otp_send", detail: "otp sent",
      });

      const { data: cap } = await admin
        .from("clinic_messaging_capability")
        .select("solapi_api_key_vault_name, solapi_secret_vault_name, sender_number")
        .eq("clinic_id", clinicId).maybeSingle();
      const capRow = cap as {
        solapi_api_key_vault_name: string | null;
        solapi_secret_vault_name: string | null;
        sender_number: string | null;
      } | null;
      if (!capRow?.solapi_api_key_vault_name || !capRow?.solapi_secret_vault_name || !capRow?.sender_number) {
        return json(200, { ok: true, sent: false, reason: "sender_not_configured" });
      }
      const apiKey = await vaultKey(capRow.solapi_api_key_vault_name);
      const apiSecret = await vaultKey(capRow.solapi_secret_vault_name);
      if (!apiKey || !apiSecret) return json(200, { ok: true, sent: false, reason: "sender_key_missing" });

      const smsBody = `[출퇴근 인증] 인증번호 ${code} (3분 이내 입력)`;
      const sent = await sendSolapi({
        apiKey, apiSecret, senderNumber: capRow.sender_number, recipientPhone: phone, body: smsBody,
      });
      return json(200, { ok: true, sent: sent.success, ...(sent.success ? {} : { send_error: sent.errorMessage }) });
    }

    // ══════════════════════════════════════════════════════════════
    // action=verify — OTP 검증(만료·시도캡) → punch + read-time 리컨사일
    // ══════════════════════════════════════════════════════════════
    if (action === "verify") {
      const token = String(body.token ?? body.t ?? "").trim();
      const rawPhone = String(body.phone ?? "").trim();
      const code = String(body.code ?? "").trim();
      const punchType = "in"; // 출근만 운영

      if (!CODE_RE.test(code)) return json(400, { ok: false, reason: "invalid_code_format" });

      const qrKey = await vaultKey("attendance_qr_hmac_key");
      if (!qrKey) return json(500, { ok: false, reason: "qr_key_missing" });
      if (!(await verifyToken(qrKey, token))) return json(401, { ok: false, reason: "qr_token_stale" });

      const phone = await normPhone(rawPhone);
      if (!phone) return json(400, { ok: false, reason: "invalid_phone" });

      const { data: otp } = await admin
        .from("attendance_otp")
        .select("id, staff_id, code_hash, expires_at, attempts, consumed_at")
        .eq("clinic_id", clinicId).eq("phone", phone).is("consumed_at", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const otpRow = otp as {
        id: string; staff_id: string; code_hash: string;
        expires_at: string; attempts: number; consumed_at: string | null;
      } | null;
      if (!otpRow) return json(404, { ok: false, reason: "otp_not_found" });

      if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
        await admin.from("attendance_audit").insert({
          clinic_id: clinicId, staff_id: otpRow.staff_id, phone, action: "otp_verify_fail", detail: "attempts_exceeded",
        });
        return json(429, { ok: false, reason: "attempts_exceeded" });
      }
      if (new Date(otpRow.expires_at).getTime() < Date.now()) {
        return json(410, { ok: false, reason: "otp_expired" });
      }

      const otpKey = await vaultKey("attendance_otp_hmac_key");
      if (!otpKey) return json(500, { ok: false, reason: "otp_key_missing" });
      const calc = await hmacSha256(`${code}:${phone}`, otpKey);

      if (calc !== otpRow.code_hash) {
        await admin.from("attendance_otp").update({ attempts: otpRow.attempts + 1 }).eq("id", otpRow.id);
        await admin.from("attendance_audit").insert({
          clinic_id: clinicId, staff_id: otpRow.staff_id, phone, action: "otp_verify_fail", detail: "code_mismatch",
        });
        const remaining = OTP_MAX_ATTEMPTS - (otpRow.attempts + 1);
        return json(401, { ok: false, reason: "otp_mismatch", remaining: Math.max(0, remaining) });
      }

      // 출근만 운영: 당일 이미 'in' punch 있으면 재출근 방지 → OTP 소비 후 중복 안내.
      const kstWorkDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const { data: existingIn } = await admin
        .from("attendance_punch")
        .select("punch_at")
        .eq("clinic_id", clinicId).eq("staff_id", otpRow.staff_id)
        .eq("work_date", kstWorkDate).eq("punch_type", "in")
        .order("punch_at", { ascending: true }).limit(1).maybeSingle();
      if ((existingIn as { punch_at: string } | null)?.punch_at) {
        await admin.from("attendance_otp").update({ consumed_at: new Date().toISOString() }).eq("id", otpRow.id);
        return json(200, {
          ok: false,
          reason: "already_checked_in",
          punch_type: "in",
          punch_at: (existingIn as { punch_at: string }).punch_at,
          work_date: kstWorkDate,
          attendance_status: await verdictFor(otpRow.staff_id, kstWorkDate),
        });
      }

      await admin.from("attendance_otp").update({ consumed_at: new Date().toISOString() }).eq("id", otpRow.id);
      await admin.from("attendance_audit").insert({
        clinic_id: clinicId, staff_id: otpRow.staff_id, phone, action: "otp_verify_ok", detail: punchType,
      });

      const qrTokenHash = await sha256Hex(token);
      const { data: punch, error: punchErr } = await admin.rpc("fn_attendance_record_punch", {
        p_clinic_id: clinicId,
        p_staff_id: otpRow.staff_id,
        p_punch_type: punchType,
        p_qr_token_hash: qrTokenHash,
        p_phone_verified: true,
        p_method: "qr_otp",
      });
      if (punchErr) return json(500, { ok: false, reason: `punch_failed:${punchErr.message}` });

      const p = (punch ?? {}) as Record<string, unknown>;
      return json(200, {
        ok: true,
        punch_type: punchType,
        punch_at: p.punch_at ?? null,
        work_date: p.work_date ?? null,
        attendance_status: p.attendance_status ?? null,
      });
    }

    return json(400, { ok: false, reason: "unknown_action" });
  } catch (e) {
    console.error("[attendance-otp] unhandled", String(e));
    return json(500, { ok: false, reason: "internal_error" });
  }
});
