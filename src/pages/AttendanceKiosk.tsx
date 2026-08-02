/**
 * AttendanceKiosk — 직원 출퇴근 회전 QR 키오스크 (리셉션 태블릿, slug 구동)
 * T-20260802-foot-ATTENDANCE-QR-PORT (롱레 원본 어댑트 이식).
 *
 * 경로: /attendance/kiosk/:slug  (App.tsx 정적 경로를 :param 보다 먼저 등록)
 *
 * 동작: attendance-otp EF(action=qr_token)로 60초 회전 서명 토큰을 받아
 *   QR( /attendance/punch?c=<slug>&t=<token> )을 렌더. 25초마다 갱신(신선도 여유).
 *   토큰=HMAC(clinic_id+time-bucket, Vault키) — 사진 유출 무력화(대리출근 방지).
 *
 * ⚠ QR 렌더: 외부 이미지 API 의존 0. 앱 내부 클라이언트에서 QR 매트릭스 생성 → 인라인 <svg>.
 *   생성기 = 벤더링된 nayuki QR(MIT), src/lib/qrcodegen.ts. 24/7 태블릿 신뢰성.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { QrCode, Ecc } from '@/lib/qrcodegen';

const REFRESH_MS = 25_000; // 회전 QR 갱신 주기(토큰 신선도 ≤ ~120s 내 안전)
const QUIET = 2;           // QR 여백(모듈 단위) — 스캐너 인식률 확보

// 문자열 → QR 매트릭스 → SVG path(모듈 1개 = 1x1 사각형). 외부 fetch 0, 순수 계산.
function buildQrSvg(text: string): { path: string; dim: number } {
  const qr = QrCode.encodeText(text, Ecc.MEDIUM); // M(15%) — 태블릿 스캔 여유
  const n = qr.size;
  const dim = n + QUIET * 2;
  let path = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.getModule(x, y)) path += `M${x + QUIET},${y + QUIET}h1v1h-1z`;
    }
  }
  return { path, dim };
}

export default function AttendanceKiosk() {
  const { slug } = useParams<{ slug: string }>();
  // 키오스크 전용 링크: URL ?k=<kiosk_token> 를 EF 에 전달(로그인 불요 인증 경로).
  const [sp] = useSearchParams();
  const kioskToken = (sp.get('k') ?? '').trim();
  const [punchUrl, setPunchUrl] = useState('');
  const [error, setError] = useState('');
  const [secs, setSecs] = useState(REFRESH_MS / 1000);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!slug) return;
    try {
      const invokeBody: Record<string, unknown> = { action: 'qr_token', slug };
      if (kioskToken) invokeBody.k = kioskToken;
      const { data, error: efErr } = await supabase.functions.invoke('attendance-otp', {
        body: invokeBody,
      });
      if (efErr || !data?.ok || !data?.token) {
        setError('QR을 불러오지 못했어요. 잠시 후 자동으로 다시 시도합니다.');
        return;
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://obliv-foot-crm.pages.dev';
      setPunchUrl(`${origin}/attendance/punch?c=${encodeURIComponent(slug)}&t=${encodeURIComponent(data.token)}`);
      setError('');
      setSecs(REFRESH_MS / 1000);
    } catch {
      setError('QR을 불러오지 못했어요. 잠시 후 자동으로 다시 시도합니다.');
    }
  }, [slug, kioskToken]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  // 남은 시간 카운트다운(표시용)
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 1 ? s - 1 : REFRESH_MS / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const svg = useMemo(() => {
    if (!punchUrl) return null;
    try {
      return buildQrSvg(punchUrl);
    } catch {
      return null;
    }
  }, [punchUrl]);

  return (
    <div
      data-testid="attendance-kiosk"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 p-8 text-white"
    >
      <h1 className="text-3xl font-bold">직원 출퇴근</h1>
      <p className="text-lg text-slate-300">본인 휴대폰으로 아래 QR을 스캔하세요</p>

      <div className="rounded-2xl bg-white p-6 shadow-xl">
        {svg ? (
          <svg
            data-testid="kiosk-qr-svg"
            viewBox={`0 0 ${svg.dim} ${svg.dim}`}
            width={360}
            height={360}
            shapeRendering="crispEdges"
            role="img"
            aria-label="출퇴근 QR"
            className="h-[360px] w-[360px]"
          >
            <rect width={svg.dim} height={svg.dim} fill="#ffffff" />
            <path d={svg.path} fill="#000000" />
          </svg>
        ) : (
          <div className="flex h-[360px] w-[360px] items-center justify-center text-slate-400">
            QR 준비 중…
          </div>
        )}
      </div>

      <p data-testid="kiosk-rotate-hint" className="text-base text-slate-400">
        보안을 위해 {secs}초 후 자동으로 새 QR로 바뀝니다
      </p>
      {error && (
        <p data-testid="kiosk-error" className="text-sm text-red-300">{error}</p>
      )}
    </div>
  );
}
