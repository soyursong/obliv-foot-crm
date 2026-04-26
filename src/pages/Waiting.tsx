/**
 * 대기실 화면 — /waiting/:clinicSlug
 *
 * 인증 불필요 (anon). TV/태블릿 풀스크린. 읽기 전용.
 * 당일 체크인 목록을 대기번호 순으로 표시. Realtime 구독.
 *
 * 정책: 개인정보 보호를 위해 이름은 마스킹 (김○수).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { STATUS_KO } from '@/lib/status';
import { playCheckInBeep } from '@/lib/audio';
import { elapsedMinutes, elapsedLabel } from '@/lib/elapsed';
import type { CheckInStatus } from '@/lib/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface WaitingRow {
  id: string;
  queue_number: number | null;
  customer_name: string | null;
  status: CheckInStatus;
  checked_in_at: string;
}

const DONE_STATUSES: CheckInStatus[] = ['done', 'cancelled'];

// 김도마 → 김○마, 홍길동 → 홍○동, 이준 → 이○
function maskName(name: string | null): string {
  if (!name) return '—';
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  if (trimmed.length === 2) return `${trimmed[0]}○`;
  return `${trimmed[0]}○${trimmed.slice(-1)}`;
}

// 레이저/시술 중 상태는 "호출됨" 강조
const CALLED_STATUSES: CheckInStatus[] = ['examination', 'consultation', 'laser', 'preconditioning'];

const STATUS_COLOR: Partial<Record<CheckInStatus, string>> = {
  registered: 'bg-gray-100 text-gray-700',
  checklist: 'bg-yellow-100 text-yellow-800',
  exam_waiting: 'bg-blue-100 text-blue-800',
  examination: 'bg-blue-500 text-white',
  consult_waiting: 'bg-indigo-100 text-indigo-800',
  consultation: 'bg-indigo-500 text-white',
  payment_waiting: 'bg-amber-100 text-amber-800',
  treatment_waiting: 'bg-teal-100 text-teal-800',
  preconditioning: 'bg-teal-400 text-white',
  laser: 'bg-emerald-500 text-white',
  done: 'bg-gray-200 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
};

export default function Waiting() {
  const { clinicSlug } = useParams<{ clinicSlug: string }>();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [clinicName, setClinicName] = useState<string>('');
  const [notFound, setNotFound] = useState(false);
  const [rows, setRows] = useState<WaitingRow[]>([]);
  const [now, setNow] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 호출 사운드: 이전 called ID를 추적하여 새 호출 시 beep
  const prevCalledIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  // 자동 스크롤
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDirectionRef = useRef<'down' | 'up'>('down');

  useEffect(() => {
    if (!clinicSlug) {
      setNotFound(true);
      return;
    }
    (async () => {
      const { data } = await anonClient
        .from('clinics')
        .select('id, name')
        .eq('slug', clinicSlug)
        .maybeSingle();
      if (!data) {
        setNotFound(true);
      } else {
        setClinicId(data.id as string);
        setClinicName(data.name as string);
      }
    })();
  }, [clinicSlug]);

  // 시계 — 30초마다 갱신 (대기 시간 표시용)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = useMemo(() => now.toISOString().slice(0, 10), [now]);

  const fetchRows = useCallback(async () => {
    if (!clinicId) return;
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;
    const { data } = await anonClient
      .from('check_ins')
      .select('id, queue_number, customer_name, status, checked_in_at')
      .eq('clinic_id', clinicId)
      .gte('checked_in_at', start)
      .lte('checked_in_at', end)
      .order('queue_number', { ascending: true, nullsFirst: false });
    const newRows = (data ?? []) as WaitingRow[];
    setRows(newRows);

    // 호출 사운드: 새로 called 상태가 된 환자 감지
    const newCalledIds = new Set(
      newRows.filter((r) => CALLED_STATUSES.includes(r.status)).map((r) => r.id),
    );
    if (!isInitialLoadRef.current) {
      for (const id of newCalledIds) {
        if (!prevCalledIdsRef.current.has(id)) {
          playCheckInBeep();
          break; // 한 번만 울림
        }
      }
    }
    prevCalledIdsRef.current = newCalledIds;
    isInitialLoadRef.current = false;
  }, [clinicId, today]);

  useEffect(() => {
    if (!clinicId) return;
    fetchRows();
    const channel = anonClient
      .channel(`waiting_${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'check_ins', filter: `clinic_id=eq.${clinicId}` },
        () => fetchRows(),
      )
      .subscribe();
    return () => {
      anonClient.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, today, fetchRows]);

  // 자동 스크롤: 오버플로우 시 부드럽게 스크롤
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const interval = setInterval(() => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) return; // 스크롤 불필요

      if (scrollDirectionRef.current === 'down') {
        if (scrollTop >= maxScroll - 2) {
          scrollDirectionRef.current = 'up';
        } else {
          container.scrollBy({ top: 1, behavior: 'smooth' });
        }
      } else {
        if (scrollTop <= 2) {
          scrollDirectionRef.current = 'down';
        } else {
          container.scrollBy({ top: -1, behavior: 'smooth' });
        }
      }
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // 풀스크린 토글
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // fullscreenchange 이벤트 동기화
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (notFound) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-red-50 to-white">
        <p className="text-2xl text-red-600">지점을 찾을 수 없습니다</p>
      </div>
    );
  }

  if (!clinicId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-teal-50 to-white">
        <p className="text-xl text-muted-foreground">불러오는 중…</p>
      </div>
    );
  }

  const active = rows.filter((r) => !DONE_STATUSES.includes(r.status));
  const called = active.filter((r) => CALLED_STATUSES.includes(r.status));
  const waiting = active.filter((r) => !CALLED_STATUSES.includes(r.status));
  const doneCount = rows.filter((r) => r.status === 'done').length;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-teal-50 to-white p-6">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-teal-700">{clinicName}</h1>
          <p className="text-gray-500">현재 대기 현황</p>
          {/* 오늘 통계 */}
          <div className="mt-1.5 flex gap-3 text-sm text-gray-600">
            <span>총 접수: <strong className="text-gray-800">{rows.length}명</strong></span>
            <span className="text-gray-300">|</span>
            <span>진행 중: <strong className="text-emerald-700">{called.length}명</strong></span>
            <span className="text-gray-300">|</span>
            <span>완료: <strong className="text-gray-500">{doneCount}명</strong></span>
          </div>
        </div>
        <div className="flex items-start gap-3">
          {/* 풀스크린 버튼 */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg bg-white/80 p-2 text-gray-500 shadow-sm transition-colors hover:bg-white hover:text-teal-600 active:scale-95"
            title={isFullscreen ? '풀스크린 해제' : '풀스크린'}
          >
            {isFullscreen ? (
              // 축소 아이콘
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4M9 15l-5 5m0 0v-4m0 4h4m6-6l5-5m0 0v4m0-4h-4" />
              </svg>
            ) : (
              // 확대 아이콘
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5m-7 14H4m0 0v-4m0 4l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
              </svg>
            )}
          </button>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-gray-800">
              {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
            </div>
            <div className="text-sm text-gray-500">{today}</div>
          </div>
        </div>
      </header>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {called.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-emerald-700">진행 중</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {called.map((r) => (
                <CalledCard key={r.id} row={r} now={now} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-700">
            대기 중 <span className="text-sm font-normal text-gray-500">({waiting.length}명)</span>
          </h2>
          {waiting.length === 0 ? (
            <p className="py-12 text-center text-lg text-gray-400">현재 대기 인원 없음</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {waiting.map((r) => (
                <WaitingCard key={r.id} row={r} now={now} />
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="mt-8 text-center text-xs text-gray-400">
        본 화면은 실시간 업데이트됩니다. 궁금한 점은 데스크에 문의해주세요.
      </footer>
    </div>
  );
}

/** 진행 중 카드 — 호출 강조 pulse 애니메이션 포함 */
function CalledCard({ row: r, now: _now }: { row: WaitingRow; now: Date }) {
  const mins = elapsedMinutes(r.checked_in_at);
  return (
    <div
      className="animate-pulse-subtle rounded-2xl border-2 border-emerald-400 bg-white p-4 shadow-sm"
      style={{
        animation: 'pulse-subtle 2s ease-in-out infinite',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-3xl font-black text-emerald-600 tabular-nums">
          #{r.queue_number ?? '—'}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold ${
            STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {STATUS_KO[r.status]}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-lg font-bold text-gray-800">
          {maskName(r.customer_name)}
        </span>
        <span className="text-sm text-gray-400">
          {elapsedLabel(mins)}
        </span>
      </div>
    </div>
  );
}

/** 대기 중 카드 — 경과 시간 표시 */
function WaitingCard({ row: r, now: _now }: { row: WaitingRow; now: Date }) {
  const mins = elapsedMinutes(r.checked_in_at);
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold text-gray-700 tabular-nums">
          #{r.queue_number ?? '—'}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {STATUS_KO[r.status]}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-base font-semibold text-gray-700">
          {maskName(r.customer_name)}
        </span>
        <span className={`text-xs tabular-nums ${mins >= 40 ? 'font-bold text-red-500' : mins >= 20 ? 'font-medium text-orange-500' : 'text-gray-400'}`}>
          {elapsedLabel(mins)}
        </span>
      </div>
    </div>
  );
}
