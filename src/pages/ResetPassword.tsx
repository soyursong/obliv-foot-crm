/**
 * ResetPassword — recovery 딥링크 착지 후 새 비밀번호 설정 화면
 * T-20260729-foot-PWRESET-FE-RECOVERY-DEEPLINK-HANDLER
 *
 * 진입: App 의 RecoveryGate 가 PASSWORD_RECOVERY 이벤트/착지 hash(type=recovery) 를 감지해
 *   Routes 대신 이 화면을 렌더한다(루트/admin 흡수 차단). 만료·오류 hash 는 expired 화면.
 *   recovery 세션 컨텍스트에서 supabase.auth.updateUser({ password }) 로 새 비밀번호를 반영한다.
 *
 * AC: (2) updateUser 반영 / (4) 만료·무효 토큰 → 재요청 안내(무한로딩·백지 금지) / (5) full-path.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  validateNewPassword,
  classifyUpdateUserError,
} from '@/lib/passwordRecovery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  /** 만료·무효 링크로 착지 → 재요청 안내 화면부터 렌더 */
  expired?: boolean;
  /** 화면 종료(RecoveryGate recovery 모드 해제) 콜백 */
  onDone?: () => void;
}

export default function ResetPassword({ expired = false, onDone }: Props) {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 만료/무효 링크 화면 여부(초기 expired 또는 updateUser 세션소실 시 전환)
  const [linkExpired, setLinkExpired] = useState(expired);

  // 로그인 화면으로 복귀 — recovery 세션은 signOut 으로 정리(데드락 가드: wrapped signOut + 2s race).
  const goLogin = async () => {
    try {
      await Promise.race([
        signOut(),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      // signOut 실패해도 로그인 화면 복귀는 계속 진행.
    }
    onDone?.();
    // T-20260805-foot-CF-PHISHING-BLOCK-LOGIN: `/login`→`/signin` (CF 피싱 오탐 path-exact 차단 회피).
    navigate('/signin');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const policyError = validateNewPassword(pw);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (pw !== pw2) {
      setError('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.');
      return;
    }

    setBusy(true);
    // recovery 세션 컨텍스트에서 새 비밀번호 반영(AC-2).
    const { error: updateError } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);

    if (updateError) {
      const cls = classifyUpdateUserError(updateError.message);
      if (cls === 'expired') {
        // 세션 만료/무효 → 만료 안내 화면 전환(무한로딩·백지 금지, AC-4).
        setLinkExpired(true);
        return;
      }
      if (cls === 'same') {
        setError('기존과 다른 새 비밀번호를 입력해 주세요.');
        return;
      }
      setError(`비밀번호 변경에 실패했어요. 잠시 후 다시 시도해 주세요. (${updateError.message})`);
      return;
    }

    toast.success('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
    await goLogin();
  };

  // ── 만료·무효 링크 안내 화면(AC-4) ──
  if (linkExpired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-teal-700">오블리브 풋센터</h1>
            <p className="mt-1 text-sm text-muted-foreground">종로점 CRM</p>
          </div>
          <div className="space-y-4 rounded-xl border bg-background p-6 text-center shadow-sm">
            <p className="text-base font-medium">링크가 만료되었어요</p>
            <p className="text-sm text-muted-foreground">
              비밀번호 재설정 링크가 만료되었거나 이미 사용되었습니다.
              <br />
              비밀번호 재설정을 다시 요청해 주세요.
            </p>
            <Button className="h-11 w-full" onClick={goLogin}>
              로그인 화면으로
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── 새 비밀번호 설정 폼(AC-1/AC-2) ──
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-teal-700">오블리브 풋센터</h1>
          <p className="mt-1 text-sm text-muted-foreground">비밀번호 재설정</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border bg-background p-6 shadow-sm"
        >
          <p className="text-sm text-muted-foreground">
            새로 사용할 비밀번호를 입력해 주세요.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">새 비밀번호</Label>
            <div className="relative">
              <Input
                id="new-pw"
                type={showPw ? 'text' : 'password'}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                placeholder="영문+숫자 8자 이상"
                required
                autoFocus
                disabled={busy}
                className="h-11 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">영문자·숫자 각 1자 이상 포함, 최소 8자</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw2">새 비밀번호 확인</Label>
            <div className="relative">
              <Input
                id="new-pw2"
                type={showPw2 ? 'text' : 'password'}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                placeholder="새 비밀번호 재입력"
                required
                disabled={busy}
                className="h-11 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPw2((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !pw || !pw2} className="h-11 w-full gap-2">
            <KeyRound className="h-4 w-4" />
            {busy ? '변경 중…' : '비밀번호 변경'}
          </Button>
          <button
            type="button"
            onClick={goLogin}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            로그인 화면으로 돌아가기
          </button>
        </form>
      </div>
    </div>
  );
}
