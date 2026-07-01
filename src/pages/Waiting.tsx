/**
 * 대기실 화면 — /waiting/:clinicSlug
 *
 * 인증 불필요 (anon). TV/태블릿 풀스크린. 읽기 전용.
 * 당일 체크인 목록을 대기번호 순으로 표시. Realtime 구독.
 *
 * 데이터 경로 (T-20260628-foot-WAITING-REALTIME / cross_crm_data_contract §16-3a):
 *   anon 은 base check_ins 를 직접 SELECT 하지 않는다. zero-PII sanitized projection
 *   테이블 `waiting_board` 를 SELECT + postgres_changes 구독한다. 성함 마스킹·terminal
 *   제외는 서버측 sync 트리거(SECURITY DEFINER)에서 적용되어, 전화/실명 등 PII 는
 *   projection 컬럼 자체에 부재(존재 0 = 노출 0). 본 화면은 마스킹 산출(display_name)을
 *   그대로 렌더하며 클라이언트 재마스킹에 의존하지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { STATUS_KO, STATUS_COLOR, CALLED_STATUSES } from '@/lib/status';
import { playCheckInBeep } from '@/lib/audio';
import { elapsedMinutes, elapsedLabel } from '@/lib/elapsed';
import { formatDateDots } from '@/lib/format';
import type { CheckInStatus } from '@/lib/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * waiting_board projection 행 (zero-PII). `room` 은 현재 status 에 대응하는 방 값(라벨
 * prefix 는 roomGuidance 에서 부여). `display_name` 은 DB 에서 마스킹된 산출(원본 성함 부재).
 */
interface WaitingRow {
  id: string;
  queue_number: number | null;
  display_name: string | null;
  status: CheckInStatus;
  checked_in_at: string;
  room: string | null;
}

/** 현재 상태에 맞는 룸 안내 문구 반환 (방 값은 projection room 컬럼, prefix 만 status 별 부여) */
function roomGuidance(row: WaitingRow): string | null {
  if (!row.room) return null;
  const { status } = row;
  if (status === 'examination' || status === 'exam_waiting') {
    return `진료실 ${row.room}`;
  }
  if (status === 'consultation' || status === 'consult_waiting') {
    return `상담실 ${row.room}`;
  }
  if (status === 'preconditioning' || status === 'treatment_waiting') {
    return `치료실 ${row.room}`;
  }
  if (status === 'laser') {
    return `레이저실 ${row.room}`;
  }
  return null;
}

const DONE_STATUSES: CheckInStatus[] = ['done', 'cancelled'];

// 성함 표시: projection 의 마스킹 산출(display_name)을 그대로 사용. 없으면 '—'.
function showName(name: string | null): string {
  return name && name.trim() ? name : '—';
}

/* STATUS_COLOR, CALLED_STATUSES → @/lib/status 공유 상수 사용 */

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
      .from('waiting_board')
      .select('id, queue_number, display_name, status, checked_in_at, room')
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
        { event: '*', schema: 'public', table: 'waiting_board', filter: `clinic_id=eq.${clinicId}` },
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

  // projection(waiting_board)은 terminal(done/cancelled) 행을 투영하지 않음 → 현재 큐만.
  // DONE_STATUSES 필터는 방어적으로 유지(정상 경로에선 해당 행 부재).
  const active = rows.filter((r) => !DONE_STATUSES.includes(r.status));
  const called = active.filter((r) => CALLED_STATUSES.includes(r.status));
  const waiting = active.filter((r) => !CALLED_STATUSES.includes(r.status));

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-teal-50 to-white p-6">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-teal-700">{clinicName}</h1>
          <p className="text-gray-500">현재 대기 현황</p>
          {/* 현재 큐 통계 (projection = 현재 대기/진행 인원만, 완료는 비집계) */}
          <div className="mt-1.5 flex gap-3 text-sm text-gray-600">
            <span>현재 인원: <strong className="text-gray-800">{active.length}명</strong></span>
            <span className="text-gray-300">|</span>
            <span>진행 중: <strong className="text-emerald-700">{called.length}명</strong></span>
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
            <div className="text-sm text-gray-500">{formatDateDots(today)}</div>
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
              {waiting.map((r, idx) => (
                <WaitingCard key={r.id} row={r} now={now} position={idx} />
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

/** 진행 중 카드 — 호출 강조 pulse 애니메이션 + 룸 안내 포함 */
function CalledCard({ row: r, now: _now }: { row: WaitingRow; now: Date }) {
  const mins = elapsedMinutes(r.checked_in_at);
  const room = roomGuidance(r);
  return (
    <div
      className="animate-pulse-subtle rounded-2xl border-2 border-emerald-400 bg-white p-3 shadow-sm"
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
          {showName(r.display_name)}
        </span>
        <span className="text-sm text-gray-400">
          {elapsedLabel(mins)}
        </span>
      </div>
      {room && (
        <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-center">
          <span className="text-sm font-bold text-emerald-700">
            {room}으로 와주세요
          </span>
        </div>
      )}
    </div>
  );
}

/** 대기 중 카드 — 경과 시간 + 앞 대기인원 표시 */
function WaitingCard({ row: r, now: _now, position }: { row: WaitingRow; now: Date; position: number }) {
  const mins = elapsedMinutes(r.checked_in_at);
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
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
          {showName(r.display_name)}
        </span>
        <span className="text-xs tabular-nums text-gray-400">
          {elapsedLabel(mins)}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-400">
        {position === 0 ? (
          <span className="font-medium text-teal-600">다음 순서</span>
        ) : (
          <span>앞에 <strong className="text-gray-600">{position}명</strong> 대기</span>
        )}
      </div>
      {roomGuidance(r) && (
        <div className="mt-1.5 rounded bg-teal-50 px-2 py-1 text-center text-xs font-medium text-teal-700">
          {roomGuidance(r)}으로 와주세요
        </div>
      )}
    </div>
  );
}
