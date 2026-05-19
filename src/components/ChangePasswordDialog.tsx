/**
 * ChangePasswordDialog — 스태프 셀프 비밀번호 변경
 * T-20260519-foot-STAFF-PW-CHANGE AC-1~4, AC-6
 *
 * - 현재 PW 확인 → supabase.auth.signInWithPassword (재인증)
 * - 새 PW 업데이트 → supabase.auth.updateUser({ password })
 * - 최소 8자 + 영문+숫자 검증 (AC-3)
 * - 성공 toast + 세션 유지 (AC-4)
 */
import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 비밀번호 정책: 최소 8자 + 영문 1자 이상 + 숫자 1자 이상 */
function validatePassword(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 최소 8자 이상이어야 합니다.';
  if (!/[a-zA-Z]/.test(pw)) return '영문자를 1자 이상 포함해야 합니다.';
  if (!/[0-9]/.test(pw)) return '숫자를 1자 이상 포함해야 합니다.';
  return null;
}

export default function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const { session } = useAuth();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);

  // 비밀번호 표시/숨김 토글
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const reset = () => {
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setBusy(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleSubmit = async () => {
    const email = session?.user.email;
    if (!email) {
      toast.error('세션 정보를 찾을 수 없습니다. 다시 로그인해 주세요.');
      return;
    }

    // 클라이언트 유효성 검사
    if (!currentPw) { toast.error('현재 비밀번호를 입력하세요.'); return; }
    const policyError = validatePassword(newPw);
    if (policyError) { toast.error(policyError); return; }
    if (newPw !== confirmPw) { toast.error('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.'); return; }
    if (currentPw === newPw) { toast.error('새 비밀번호는 현재 비밀번호와 달라야 합니다.'); return; }

    setBusy(true);

    // 1) 현재 비밀번호 재인증으로 검증
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPw,
    });
    if (signInError) {
      setBusy(false);
      toast.error('현재 비밀번호가 올바르지 않습니다.');
      return;
    }

    // 2) 새 비밀번호로 업데이트 — 세션 유지됨 (AC-4, AC-6)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
    setBusy(false);

    if (updateError) {
      toast.error(`비밀번호 변경 실패: ${updateError.message}`);
      return;
    }

    toast.success('비밀번호가 변경되었습니다.');
    handleClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>비밀번호 변경</DialogTitle>
          <DialogDescription>
            현재 비밀번호를 입력한 후 새 비밀번호를 설정하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 현재 비밀번호 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-current">현재 비밀번호</Label>
            <div className="relative">
              <Input
                id="pw-current"
                type={showCurrent ? 'text' : 'password'}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                placeholder="현재 비밀번호"
                disabled={busy}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* 새 비밀번호 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-new">새 비밀번호</Label>
            <div className="relative">
              <Input
                id="pw-new"
                type={showNew ? 'text' : 'password'}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                placeholder="영문+숫자 8자 이상"
                disabled={busy}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">영문자·숫자 각 1자 이상 포함, 최소 8자</p>
          </div>

          {/* 비밀번호 확인 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-confirm">새 비밀번호 확인</Label>
            <div className="relative">
              <Input
                id="pw-confirm"
                type={showConfirm ? 'text' : 'password'}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                placeholder="새 비밀번호 재입력"
                disabled={busy}
                className="pr-9"
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleSubmit(); }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={busy}
          >
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || !currentPw || !newPw || !confirmPw}
            className="gap-2"
          >
            <KeyRound className="h-4 w-4" />
            {busy ? '변경 중…' : '변경 저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
