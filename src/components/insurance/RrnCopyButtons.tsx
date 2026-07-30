/**
 * RrnCopyButtons — 주민번호 앞자리/뒷자리 클립보드 복사 버튼 2개 (공용)
 *
 * T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS (이은상 팀장 2026-07-30, G-1 PASS)
 *   공단 포털 자격조회 입력칸이 앞6/뒷7로 분리되어 있어, 마스킹된 2번차트에서
 *   주민번호를 육안·복사할 수 없던 문제를 해소한다. 화면 마스킹은 그대로 두고
 *   이미 세션 메모리에 있는 복호값(rrnFull)을 클립보드로만 전달한다.
 *
 * ★평행경로 발산 금지★ — AC-1(2번차트)과 AC-2(건보조회 패널)가 동일 로직을
 *   공유해야 하므로 이 단일 컴포넌트로 추출했다. 양쪽은 이 컴포넌트만 렌더한다.
 *
 * 불변식 (핸드오프 §5·§6):
 *   - rrnFull 을 화면·토스트·title·aria-label·DOM 어디에도 평문 렌더하지 않는다.
 *   - toast.confirm 만 사용(toast.success/info 는 묵음 → 피드백 0).
 *   - navigator.clipboard.writeText() 는 감사 RPC await 보다 반드시 먼저 호출한다
 *     (user gesture 소실 시 Chrome 이 클립보드 쓰기를 거부).
 *   - 클립보드 실패 시 평문 폴백(prompt/alert/textarea) 금지.
 *   - rrnFull 이 falsy 면 버튼 자체를 렌더하지 않는다(disabled 아님).
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';

interface Props {
  /** 세션 메모리의 복호 평문(포맷 무관). falsy 면 버튼 미렌더. */
  rrnFull: string | null | undefined;
  /** 감사 RPC 인자(anti-IDOR: by/role/clinic 은 서버측 파생). */
  customerId: string;
  /** 오조회 방어(AC-3): 버튼 title 에 대상 이름 병기. 화면 평문 렌더 아님. */
  customerName?: string | null;
}

export function RrnCopyButtons({ rrnFull, customerId, customerName }: Props) {
  const [copied, setCopied] = useState<'front' | 'back' | null>(null);

  // rrnFull 없으면 렌더 자체를 하지 않는다(§5: disabled 아님).
  if (!rrnFull) return null;

  const onCopy = async (part: 'front' | 'back') => {
    if (!rrnFull) return;
    const d = rrnFull.replace(/\D/g, '');
    const v = part === 'front' ? d.slice(0, 6) : d.slice(6, 13);
    try {
      // ① 먼저 — user gesture(transient activation) 유효 구간에서 클립보드 쓰기.
      await navigator.clipboard.writeText(v);
    } catch {
      // ❌ 평문 폴백(prompt/alert/textarea) 금지 — 실패는 실패로 알리고 종료.
      toast.error('복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
      return;
    }
    setCopied(part);
    setTimeout(() => setCopied(null), 1500);
    // ✅ toast.confirm — 값은 넣지 않는다(토스트=화면 렌더 → §5 평문 노출 금지).
    toast.confirm(
      part === 'front' ? '주민번호 앞자리가 복사되었습니다' : '주민번호 뒷자리가 복사되었습니다',
    );
    // ② 나중 — fire-and-forget 감사 적재(복호 호출 없는 클립보드 반출 기록).
    void supabase.rpc('log_rrn_clipboard_copy', { p_customer_id: customerId });
  };

  const nameLabel = customerName ? `${customerName} ` : '';

  return (
    <div className="flex items-center gap-1" data-testid="rrn-copy-buttons">
      <button
        type="button"
        onClick={() => void onCopy('front')}
        title={`${nameLabel}주민번호 앞자리 복사`}
        data-testid="rrn-copy-front"
        className="inline-flex items-center gap-1 rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 transition"
      >
        {copied === 'front' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        앞자리
      </button>
      <button
        type="button"
        onClick={() => void onCopy('back')}
        title={`${nameLabel}주민번호 뒷자리 복사`}
        data-testid="rrn-copy-back"
        className="inline-flex items-center gap-1 rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 transition"
      >
        {copied === 'back' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        뒷자리
      </button>
    </div>
  );
}
