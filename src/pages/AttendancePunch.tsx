/**
 * AttendancePunch — 직원 셀프 출근 (출근만 운영)
 * T-20260802-foot-ATTENDANCE-QR-PORT (롱레 원본 어댑트 이식).
 *
 * 경로: /attendance/punch?c=<slug>&t=<qr_token>  (public, 비로그인)
 *
 * 2경로:
 *   ① 기기 바인딩(원탭): 이 폰에 device_token 없음 → 등록(이름 입력→매니저 승인요청). 서버가
 *      device_token(256bit) 발급 → 폰 localStorage 저장 + 서버엔 hash만. 매니저 승인=신원 앵커.
 *      등록 후: QR 스캔 → 저장된 device_token 자동 제시 → 원탭 출근(번호입력·SMS·OTP 불요).
 *   ② 폰+OTP(SMS): 전화번호 입력 → 솔라피 SMS 인증번호(3분·시도캡5회) → 출근.
 *
 * ⚠ 폰대조·OTP검증·device 발급/검증·punch write 는 attendance-otp EF(service_role) 단일창구.
 *   anon 직접 테이블 접근 0. 태블릿/폰 UX(큰 버튼·teal-emerald).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// 기기 바인딩 기본 노출 스위치. false → 순수 SMS-OTP 로 회귀(kill-switch).
const DEVICE_BINDING_ENABLED = true;

type Step = 'choice' | 'device_home' | 'enroll_name' | 'enroll_pending' | 'phone' | 'otp' | 'done';

const REASON_MSG: Record<string, string> = {
  qr_token_stale: 'QR이 만료됐어요. 태블릿의 최신 QR을 다시 스캔해 주세요.',
  invalid_phone: '휴대폰 번호 형식이 올바르지 않아요.',
  phone_not_registered: '등록되지 않은 번호예요. 관리자에게 번호 등록을 요청하세요.',
  rate_limited: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  resend_cooldown: '방금 발송했어요. 잠시 후 다시 시도해 주세요.',
  otp_expired: '만료된 인증번호예요. 다시 발송해 주세요.',
  otp_mismatch: '인증번호가 일치하지 않아요.',
  attempts_exceeded: '인증 시도 횟수를 초과했어요. 다시 발송해 주세요.',
  otp_not_found: '유효한 인증번호가 없어요. 다시 발송해 주세요.',
  invalid_code_format: '인증번호 6자리를 입력해 주세요.',
  sender_not_configured: '문자 발송 설정이 준비 중이에요. 관리자에게 문의하세요.',
  clinic_not_found: '지점 정보를 찾을 수 없어요.',
  already_checked_in: '오늘은 이미 출근 처리됐어요.',
  name_required: '본인 이름을 입력해 주세요.',
  device_pending: '아직 관리자 승인 전이에요. 승인 후 다시 시도해 주세요.',
  device_revoked: '이 기기 등록이 해제됐어요. 다시 등록해 주세요.',
  device_not_registered: '기기 등록 정보를 찾을 수 없어요. 다시 등록해 주세요.',
  invalid_device_token: '기기 정보가 올바르지 않아요. 다시 등록해 주세요.', // gitleaks:allow — EF reason 키(시크릿 아님)
};
function msgFor(reason?: string): string {
  return (reason && REASON_MSG[reason]) || '처리 중 문제가 발생했어요. 다시 시도해 주세요.';
}

type StoredDevice = { device_id: string; device_token: string };
function deviceKey(slug: string): string { return `foot_att_dev_${slug}`; }
function readDevice(slug: string): StoredDevice | null {
  if (!slug || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(deviceKey(slug));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.device_id === 'string' && typeof p.device_token === 'string') return p;
  } catch { /* noop */ }
  return null;
}
function writeDevice(slug: string, d: StoredDevice) {
  try { window.localStorage.setItem(deviceKey(slug), JSON.stringify(d)); } catch { /* noop */ }
}
function clearDevice(slug: string) {
  try { window.localStorage.removeItem(deviceKey(slug)); } catch { /* noop */ }
}

export default function AttendancePunch() {
  const [sp] = useSearchParams();
  const slug = (sp.get('c') || '').trim().toLowerCase();
  const token = (sp.get('t') || '').trim();

  const stored = useMemo(() => (DEVICE_BINDING_ENABLED ? readDevice(slug) : null), [slug]);
  const initialStep: Step = DEVICE_BINDING_ENABLED ? (stored ? 'device_home' : 'choice') : 'phone';

  const [step, setStep] = useState<Step>(initialStep);
  const [device, setDevice] = useState<StoredDevice | null>(stored);
  const [enrollName, setEnrollName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [result, setResult] = useState<{ punch_at: string | null; attendance_status: string | null; already: boolean } | null>(null);

  const missingParams = useMemo(() => !slug || !token, [slug, token]);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // attendance-otp EF 는 업무 거절을 4xx 로 돌려주고 supabase-js 가 FunctionsHttpError 로 감싸 data=null 로 만드므로
  // error.context(Response) 본문 {ok,reason} 을 직접 파싱해 정상 응답처럼 반환한다.
  const invoke = useCallback(async (bodyExtra: Record<string, unknown>): Promise<{ data: any; error: any }> => {
    const res = await supabase.functions.invoke('attendance-otp', { body: { slug, token, ...bodyExtra } });
    const ctx = (res.error as any)?.context;
    if (res.error && ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.json();
        if (parsed && typeof parsed === 'object') return { data: parsed, error: null };
      } catch { /* 본문 파싱 실패 시 원본 에러 유지 */ }
    }
    return res;
  }, [slug, token]);

  // ── 기기 등록 요청 ──
  async function handleEnrollRequest() {
    setError(''); setNotice('');
    const name = enrollName.trim();
    if (!name) { setError('본인 이름을 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const label = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : '';
      const { data, error: efErr } = await invoke({ action: 'enroll_request', name, device_label: label });
      if (efErr || !data?.ok || !data?.device_id || !data?.device_token) { setError(msgFor(data?.reason)); return; }
      const d: StoredDevice = { device_id: data.device_id, device_token: data.device_token };
      writeDevice(slug, d);
      setDevice(d);
      setStep('enroll_pending');
    } catch { setError('기기 등록 중 문제가 발생했어요.'); }
    finally { setBusy(false); }
  }

  // ── 승인 상태 폴링(enroll_pending) ──
  useEffect(() => {
    if (step !== 'enroll_pending' || !device?.device_id) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await invoke({ action: 'enroll_status', device_id: device.device_id });
      if (cancelled) return;
      const status = data?.status;
      if (status === 'active') {
        setNotice('승인됐어요! 이제 출근할 수 있어요.');
        setStep('device_home');
      } else if (status === 'revoked') {
        clearDevice(slug); setDevice(null);
        setError('기기 등록이 거절/해제됐어요. 다시 등록해 주세요.');
        setStep('choice');
      }
    };
    check();
    pollTimer.current = setInterval(check, 3000);
    return () => { cancelled = true; if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [step, device?.device_id, slug, invoke]);

  // ── 원탭 출근(기기 바인딩) ──
  async function handleDevicePunch() {
    if (!device?.device_token) { setStep('choice'); return; }
    setError(''); setNotice('');
    setBusy(true);
    try {
      const { data, error: efErr } = await invoke({ action: 'punch_device', device_token: device.device_token });
      if (data?.reason === 'already_checked_in') {
        setResult({ punch_at: data.punch_at ?? null, attendance_status: data.attendance_status ?? null, already: true });
        setStep('done');
        return;
      }
      if (data?.reason === 'device_pending') {
        setStep('enroll_pending');
        return;
      }
      if (data?.reason === 'device_revoked' || data?.reason === 'device_not_registered' || data?.reason === 'invalid_device_token') {
        clearDevice(slug); setDevice(null);
        setError(msgFor(data.reason));
        setStep('choice');
        return;
      }
      if (efErr || !data?.ok) { setError(msgFor(data?.reason)); return; }
      setResult({ punch_at: data.punch_at, attendance_status: data.attendance_status, already: false });
      setStep('done');
    } catch { setError('출근 기록 중 문제가 발생했어요.'); }
    finally { setBusy(false); }
  }

  // ── SMS-OTP ──
  async function handleSend() {
    setError(''); setRemaining(null);
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length < 10) { setError('휴대폰 번호를 정확히 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const { data, error: efErr } = await invoke({ action: 'send', phone });
      if (efErr || !data?.ok) { setError(msgFor(data?.reason)); return; }
      if (data.sent === false) { setError(msgFor(data.reason)); return; }
      setCode('');
      setStep('otp');
    } catch { setError('문자 발송 중 문제가 발생했어요.'); }
    finally { setBusy(false); }
  }

  async function handleVerify() {
    setError(''); setRemaining(null);
    if (!/^\d{6}$/.test(code)) { setError('인증번호 6자리를 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const { data, error: efErr } = await invoke({ action: 'verify', phone, code, punch_type: 'in' });
      if (data?.reason === 'already_checked_in') {
        setResult({ punch_at: data.punch_at ?? null, attendance_status: data.attendance_status ?? null, already: true });
        setStep('done');
        return;
      }
      if (efErr || !data?.ok) {
        setError(msgFor(data?.reason));
        if (typeof data?.remaining === 'number') setRemaining(data.remaining);
        return;
      }
      setResult({ punch_at: data.punch_at, attendance_status: data.attendance_status, already: false });
      setStep('done');
    } catch { setError('출근 기록 중 문제가 발생했어요.'); }
    finally { setBusy(false); }
  }

  function reset() {
    setPhone(''); setCode(''); setError(''); setNotice(''); setRemaining(null); setResult(null);
    const d = DEVICE_BINDING_ENABLED ? readDevice(slug) : null;
    setDevice(d);
    setStep(DEVICE_BINDING_ENABLED ? (d ? 'device_home' : 'choice') : 'phone');
  }

  const timeLabel = (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso));
    } catch { return ''; }
  };

  return (
    <div data-testid="attendance-punch" className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-md">
        <h1 className="mb-1 text-xl font-bold text-slate-800">직원 출근</h1>
        <p className="mb-5 text-sm text-slate-500">
          {step === 'phone' || step === 'otp' ? '본인 명의 휴대폰으로 인증합니다' : '현장 QR로 출근합니다'}
        </p>

        {missingParams && (
          <p data-testid="punch-missing-params" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            QR을 다시 스캔해 주세요. (접근 정보가 없어요)
          </p>
        )}

        {/* 선택: 기기 등록 vs 문자 인증 */}
        {!missingParams && step === 'choice' && (
          <div className="space-y-3" data-testid="punch-choice">
            <Button
              data-testid="punch-device-enroll-btn"
              className="h-14 w-full bg-emerald-600 text-base hover:bg-emerald-700"
              disabled={busy}
              onClick={() => { setError(''); setNotice(''); setEnrollName(''); setStep('enroll_name'); }}
            >
              이 휴대폰 등록하고 출근하기
            </Button>
            <p className="text-xs text-slate-400">처음이면 이 휴대폰을 등록하세요. 등록 후에는 QR만 찍으면 한 번에 출근돼요.</p>
            <Button
              data-testid="punch-sms-btn"
              variant="outline"
              className="h-11 w-full"
              disabled={busy}
              onClick={() => { setError(''); setNotice(''); setPhone(''); setStep('phone'); }}
            >
              휴대폰 문자로 출근하기
            </Button>
          </div>
        )}

        {/* 기기 등록: 이름 입력 → 승인요청 */}
        {!missingParams && step === 'enroll_name' && (
          <div className="space-y-3" data-testid="punch-enroll-name">
            <label className="text-sm font-medium text-slate-700">본인 이름</label>
            <Input
              data-testid="punch-enroll-name-input"
              type="text"
              placeholder="이름"
              value={enrollName}
              onChange={(e) => setEnrollName(e.target.value)}
              className="h-12 text-lg"
            />
            <p className="text-xs text-slate-400">관리자가 확인하고 승인하면 이 휴대폰으로 출근할 수 있어요.</p>
            <Button
              data-testid="punch-enroll-submit-btn"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={handleEnrollRequest}
            >
              {busy ? '요청 중…' : '등록 요청하기'}
            </Button>
            <Button variant="outline" className="h-10 w-full" disabled={busy} onClick={() => setStep('choice')}>
              뒤로
            </Button>
          </div>
        )}

        {/* 승인 대기 */}
        {!missingParams && step === 'enroll_pending' && (
          <div className="space-y-4 text-center" data-testid="punch-enroll-pending">
            <div className="text-4xl">⏳</div>
            <p className="text-lg font-semibold text-slate-800">관리자 승인을 기다리고 있어요</p>
            <p className="text-sm text-slate-500">관리자가 승인하면 자동으로 출근 화면으로 넘어가요.</p>
            <Button
              data-testid="punch-enroll-recheck-btn"
              className="h-12 w-full"
              disabled={busy}
              onClick={handleDevicePunch}
            >
              승인됐어요 · 출근하기
            </Button>
            <Button variant="outline" className="h-10 w-full" onClick={() => { setNotice(''); setError(''); setStep('choice'); }}>
              처음으로
            </Button>
          </div>
        )}

        {/* 등록 완료 기기: 원탭 출근 */}
        {!missingParams && step === 'device_home' && (
          <div className="space-y-3" data-testid="punch-device-home">
            <p className="text-sm text-slate-500">등록된 휴대폰이에요. 아래 버튼으로 바로 출근하세요.</p>
            <Button
              data-testid="punch-device-in-btn"
              className="h-16 w-full bg-emerald-600 text-lg hover:bg-emerald-700"
              disabled={busy}
              onClick={handleDevicePunch}
            >
              {busy ? '기록 중…' : '출근하기'}
            </Button>
            <Button
              data-testid="punch-device-reenroll-btn"
              variant="outline"
              className="h-9 w-full text-xs text-slate-400"
              disabled={busy}
              onClick={() => { clearDevice(slug); setDevice(null); setError(''); setNotice(''); setStep('choice'); }}
            >
              다른 방법으로 출근 / 기기 다시 등록
            </Button>
          </div>
        )}

        {/* SMS: 폰 입력 */}
        {!missingParams && step === 'phone' && (
          <div className="space-y-3" data-testid="punch-step-phone">
            <label className="text-sm font-medium text-slate-700">휴대폰 번호</label>
            <Input
              data-testid="punch-phone-input"
              type="tel"
              inputMode="numeric"
              placeholder="010-1234-5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-12 text-lg"
            />
            <Button
              data-testid="punch-send-btn"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={handleSend}
            >
              {busy ? '발송 중…' : '인증번호 받기'}
            </Button>
            {DEVICE_BINDING_ENABLED && (
              <Button variant="outline" className="h-10 w-full" disabled={busy} onClick={() => { setError(''); setStep('choice'); }}>
                뒤로
              </Button>
            )}
          </div>
        )}

        {/* SMS: OTP 입력 */}
        {!missingParams && step === 'otp' && (
          <div className="space-y-3" data-testid="punch-step-otp">
            <label className="text-sm font-medium text-slate-700">인증번호 6자리</label>
            <Input
              data-testid="punch-otp-input"
              type="tel"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              className="h-12 text-center text-2xl tracking-[0.4em]"
            />
            <p className="text-xs text-slate-400">문자로 받은 인증번호를 입력한 뒤 출근하기를 누르세요 (유효 3분)</p>
            <Button
              data-testid="punch-in-btn"
              className="h-14 w-full bg-emerald-600 text-base hover:bg-emerald-700"
              disabled={busy}
              onClick={handleVerify}
            >
              {busy ? '기록 중…' : '출근하기'}
            </Button>
            <Button variant="outline" className="h-10 w-full" disabled={busy} onClick={handleSend}>
              인증번호 다시 받기
            </Button>
          </div>
        )}

        {/* 결과 */}
        {!missingParams && step === 'done' && result && (
          <div className="space-y-4 text-center" data-testid="punch-step-done">
            <div className="text-4xl">{result.already ? 'ℹ️' : '✅'}</div>
            <p data-testid="punch-result-text" className="text-lg font-semibold text-slate-800">
              {result.already ? '이미 출근 처리됐어요' : '출근 기록됨'} {timeLabel(result.punch_at)}
            </p>
            {result.already && (
              <p data-testid="punch-already" className="text-sm text-slate-500">오늘 출근은 한 번만 기록돼요.</p>
            )}
            {!result.already && result.attendance_status === 'late' && (
              <p className="text-sm font-medium text-orange-600">지각으로 기록되었어요</p>
            )}
            <Button data-testid="punch-reset-btn" variant="outline" className="h-11 w-full" onClick={reset}>
              처음으로
            </Button>
          </div>
        )}

        {notice && (
          <p data-testid="punch-notice" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>
        )}
        {error && (
          <p data-testid="punch-error" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}{remaining != null ? ` (남은 시도 ${remaining}회)` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
