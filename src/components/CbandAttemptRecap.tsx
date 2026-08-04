/**
 * CbandAttemptRecap.tsx — 코밴 직결결제(BETA) 결과 미아건 재표시 (상세시트 재진입)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260803-foot-CBAND-PAYRESULT-SWEEP (AC-1 기회주의 스윕 + AC-2 재표시)
 *
 * 왜: 결제 진행 중 탭닫힘/새로고침 → WS 소멸 → 응답 전이면 시도레코드가 'requested'로 고아(단말은
 *     승인됐을 수 있으나 payments 미기록). 정상 흐름의 결과 다이얼로그(1회성·휘발)를 보완해,
 *     상세시트 재진입 시 최근 시도의 '확인 필요'(attention) / '지연'(오래 남은 requested)을 다시 보여준다.
 *
 * ★스키마 무접촉(AC-6 동시성방지 선례 계승 — 신규 테이블/컬럼/enum/EF/cron 0 → DA CONSULT 불요):
 *   진입 시 기회주의 스윕(자기 clinic 고아 'requested'→'attention', 기존 UPDATE RLS) 1회 후
 *   최근 시도 재조회(기존 SELECT RLS). 'attention'은 이미 status CHECK 에 존재(신규 enum 아님).
 * ★멱등: 스윕은 payments 를 만들지 않음(이중수납 0). 실장은 단말 [승인내역조회] 대조 후 수동 수납 반영(기존 경로).
 *
 * 태블릿 UX: teal-emerald(경고는 amber) · 큰 글씨 · 천단위 콤마 · 한국어 · Asia/Seoul. (풋센터 표준)
 * 기능플래그 VITE_CBAND_PAY OFF → 완전 미노출(회귀 0). 재표시할 미아건이 없어도 미노출.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { formatAmount, formatDateTimeDots } from '@/lib/format';
import {
  isCbandPayEnabled, selectRecapAttempts, CBAND_ORPHAN_STALE_MINUTES,
  type CbandRecapItem,
} from '@/lib/cband/paymentFlow';
import { supabaseAttemptStore } from '@/lib/cband/supabaseAttemptStore';
import { TRANTYPE_CANCEL } from '@/lib/cband/protocol';

interface Props {
  checkInId: string;
  clinicId: string;
}

export default function CbandAttemptRecap({ checkInId, clinicId }: Props) {
  const enabled = isCbandPayEnabled();
  const [items, setItems] = useState<CbandRecapItem[]>([]);
  const [loading, setLoading] = useState(false);
  // ★AC-8 수동 종료 처리 중인 시도 id(중복클릭 방지).
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      // ★AC-1 기회주의 스윕 먼저(자기 clinic 고아 'requested'→'attention'). 실패해도 재표시는 진행.
      if (supabaseAttemptStore.sweepStaleRequested) {
        try {
          await supabaseAttemptStore.sweepStaleRequested({ clinicId, checkInId });
        } catch (e) {
          console.error('코밴 고아 스윕 실패(재표시는 계속):', (e as Error)?.message);
        }
      }
      // ★AC-2 최근 시도 재조회 → 확인필요/지연만 선별(순수 판정).
      const rows = supabaseAttemptStore.listRecentAttempts
        ? await supabaseAttemptStore.listRecentAttempts({ clinicId, checkInId })
        : [];
      if (!mounted.current) return;
      setItems(selectRecapAttempts(rows, Date.now()));
    } catch (e) {
      console.error('코밴 결제 시도 재표시 조회 실패:', (e as Error)?.message);
      if (mounted.current) setItems([]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [enabled, clinicId, checkInId]);

  // ★AC-8 수동 종료 처리 — 실장이 단말 [승인내역조회] 영수증 대조 후 이 시도를 직접 종료(잠금 해제).
  //   releaseAttempt: payment_id 있으면 'approved'(실제 승인), 없으면 'failed'(미성립). 어느 쪽이든
  //   'requested'/'attention' 이탈 → 재결제 차단 해소. 성공/실패 무관 재조회(load)로 목록 갱신.
  const release = useCallback(async (id: string) => {
    if (!supabaseAttemptStore.releaseAttempt) return;
    setReleasingId(id);
    try {
      await supabaseAttemptStore.releaseAttempt(id);
    } catch (e) {
      console.error('코밴 시도 종료 처리 실패:', (e as Error)?.message);
    } finally {
      if (mounted.current) setReleasingId(null);
      await load();
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  if (!enabled) return null;
  if (items.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3" data-testid="cband-attempt-recap">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-bold text-amber-800">
          <AlertTriangle className="h-4 w-4" /> 카드 단말 결제 확인 필요
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
          data-testid="btn-cband-recap-refresh"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} /> 다시 확인
        </button>
      </div>
      <p className="text-xs leading-relaxed text-amber-700">
        결제 도중 화면이 닫혔거나 새로고침되어 결과가 확인되지 않은 시도예요.
        카드 단말기 [승인내역조회]로 실제 승인 여부를 대조한 뒤 처리해 주세요.
        (아직 수납으로 기록되지 않았습니다 — 실제 승인이면 수납 등록, 아니면 넘기세요.)
      </p>
      <ul className="space-y-1.5" data-testid="cband-recap-list">
        {items.map(({ view, kind }) => (
          <li
            key={view.id}
            className="rounded border border-amber-200 bg-white/70 p-2 text-xs"
            data-testid={`cband-recap-item-${view.id}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-amber-900">
                {view.tranType === TRANTYPE_CANCEL ? '결제취소' : '카드결제'} {formatAmount(view.amount)}원
              </span>
              <span
                className="rounded-sm bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-700"
                data-testid={`cband-recap-kind-${kind}`}
              >
                {kind === 'attention' ? '확인 필요' : `지연(${CBAND_ORPHAN_STALE_MINUTES}분+ 무응답)`}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
              <span>{formatDateTimeDots(view.createdAt)}</span>
              <span className="font-mono">
                조회번호{' '}
                <span className="font-bold tracking-wider text-gray-700" data-testid={`cband-recap-msgtrace-${view.id}`}>
                  {view.msgTrace}
                </span>
              </span>
            </div>
            {/* ★AC-8 수동 종료 처리 — 영수증 대조 후 이 시도를 종료(잠금 해제 → 재결제 가능). 큰 버튼(태블릿). */}
            {supabaseAttemptStore.releaseAttempt && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  data-testid={`btn-cband-recap-release-${view.id}`}
                  onClick={() => release(view.id)}
                  disabled={releasingId === view.id}
                  title="단말기 영수증으로 확인한 뒤, 이 시도를 종료됨으로 처리해 재결제를 진행할 수 있게 합니다."
                >
                  {releasingId === view.id ? '처리 중…' : '이 시도는 종료됨으로 처리'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
