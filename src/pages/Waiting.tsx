/**
 * 대기실 화면 — /waiting/:clinicSlug
 *
 * 인증 불필요 (anon). TV/태블릿 풀스크린. 읽기 전용.
 * 당일 체크인 목록을 대기번호 순으로 표시. Realtime 구독.
 *
 * 정책: 개인정보 보호를 위해 이름은 마스킹 (김○수).
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { STATUS_KO } from '@/lib/status';
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

  // 시계
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = useMemo(() => now.toISOString().slice(0, 10), [now]);

  const fetchRows = async () => {
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
    setRows((data ?? []) as WaitingRow[]);
  };

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
  }, [clinicId, today]);

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

  return (
    <div className="min-h-dvh bg-gradient-to-b from-teal-50 to-white p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold text-teal-700">{clinicName}</h1>
          <p className="text-gray-500">현재 대기 현황</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-gray-800">
            {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
          </div>
          <div className="text-sm text-gray-500">{today}</div>
        </div>
      </header>

      {called.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-emerald-700">진행 중</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {called.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border-2 border-emerald-400 bg-white p-4 shadow-sm"
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
                <div className="mt-2 text-lg font-bold text-gray-800">
                  {maskName(r.customer_name)}
                </div>
              </div>
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
              <div
                key={r.id}
                className="rounded-xl border bg-white p-4 shadow-sm"
              >
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
                <div className="mt-1.5 text-base font-semibold text-gray-700">
                  {maskName(r.customer_name)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-8 text-center text-xs text-gray-400">
        본 화면은 실시간 업데이트됩니다. 궁금한 점은 데스크에 문의해주세요.
      </footer>
    </div>
  );
}
