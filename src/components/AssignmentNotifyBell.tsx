// T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (B안) — 상단 🔔 자동배정 알림 (팀 전체 공유)
//
// 자동배정 발생 시(assignment_actions INSERT, action_type='auto_assign') 상단 종 아이콘에
// 미읽음 건수를 표시하고, 클릭하면 "고객명 → 담당자명 배정됨" 내역 드롭다운을 보여준다.
//
// ── 데이터 (신규 스키마 0) ──────────────────────────────────────────────────
//   기존 assignment_actions(자동배정 SSOT, T-20260617-foot-AUTOASSIGN-BALANCE-TOSS) 재사용.
//   고객명 = check_ins.customer_name(denorm) / 담당자명 = staff.name.
//   ⚠ staff.display_name 컬럼은 DB 미존재(STAFF-NAME-UNIFY 타입만 추가, 미마이그) → select 금지(400). name만 조회.
//   읽음 상태 = 사용자별 localStorage(읽은 action id Set). DB 컬럼/테이블 추가 없음.
//
// ── 읽음 정책 (시나리오3 명시) ──────────────────────────────────────────────
//   per-item 읽음: 알림 1건 클릭 → 그 건만 읽음(🔔 1 감소). "모두 읽음" 버튼 → 전체 0.
//   (= 연속 2건 발생 시 🔔2, 1건만 읽으면 🔔1 — 일괄이 아닌 개별 차감)
//
// ── 실시간 + 폴백 ───────────────────────────────────────────────────────────
//   기존 Supabase realtime 채널 패턴 재사용(assignment_actions INSERT 구독).
//   realtime 미발화 환경 대비 15초 폴링 fallback(티켓 허용). 오늘(KST) 발생분만 집계.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCheck, Megaphone, X } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate } from '@/lib/format';
import { ASSIGN_SILENT_REASON } from '@/lib/autoAssign';
import type { AssignmentAction } from '@/lib/types';

interface AssignNotif {
  id: string;
  customerName: string;
  staffName: string;
  createdAt: string;
}

const POLL_MS = 15_000;

function readStorageKey(userId: string | null | undefined): string {
  return `foot-assign-notif-read-${userId ?? 'anon'}`;
}

function loadReadIds(userId: string | null | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(readStorageKey(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistReadIds(userId: string | null | undefined, ids: Set<string>) {
  try {
    localStorage.setItem(readStorageKey(userId), JSON.stringify([...ids]));
  } catch {
    /* localStorage 불가 환경 무시 */
  }
}

export default function AssignmentNotifyBell({ clinicId }: { clinicId: string | null }) {
  const { profile } = useAuth();
  const [notifs, setNotifs] = useState<AssignNotif[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds(profile?.id));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 사용자 전환 시 읽음 set 재로딩
  useEffect(() => {
    setReadIds(loadReadIds(profile?.id));
  }, [profile?.id]);

  // ── 데이터 로드: 오늘(KST) auto_assign actions + 고객/담당 이름 매핑 ──────────
  const fetchNotifs = useCallback(async () => {
    if (!clinicId) {
      setNotifs([]);
      return;
    }
    const today = todaySeoulISODate(); // YYYY-MM-DD
    const dayStart = `${today}T00:00:00+09:00`;
    try {
      const { data } = await supabase
        .from('assignment_actions')
        .select('id, check_in_id, to_staff_id, created_at, action_type, reason')
        .eq('clinic_id', clinicId)
        .eq('action_type', 'auto_assign')
        .gte('created_at', dayStart)
        .order('created_at', { ascending: false })
        .limit(50);
      // T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP: 재진 지정담당 정상배정(sentinel reason)은
      //   '담당자 배정 알림'에서 제외(이미 지정 담당 → 배정 인지 불필요). 그 외(초진/휴무 fallback 등)는 노출.
      const actions = ((data ?? []) as AssignmentAction[]).filter(
        (a) => a.reason !== ASSIGN_SILENT_REASON,
      );
      if (actions.length === 0) {
        setNotifs([]);
        return;
      }
      // 이름 매핑(별도 조회 — embed FK 가정 회피)
      const staffIds = [...new Set(actions.map((a) => a.to_staff_id).filter(Boolean) as string[])];
      const checkInIds = [...new Set(actions.map((a) => a.check_in_id).filter(Boolean) as string[])];
      const [staffRes, ciRes] = await Promise.all([
        staffIds.length
          ? supabase.from('staff').select('id, name').in('id', staffIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        checkInIds.length
          ? supabase.from('check_ins').select('id, customer_name').in('id', checkInIds)
          : Promise.resolve({ data: [] as { id: string; customer_name: string }[] }),
      ]);
      const staffMap = new Map<string, string>();
      for (const s of (staffRes.data ?? []) as { id: string; name: string }[]) {
        // AC-2: 실제 담당자 이름(name) 노출. name이 null/빈 값일 때만 '담당자' 폴백.
        staffMap.set(s.id, (s.name ?? '').trim() || '담당자');
      }
      const ciMap = new Map<string, string>();
      for (const c of (ciRes.data ?? []) as { id: string; customer_name: string }[]) {
        ciMap.set(c.id, (c.customer_name ?? '').trim() || '고객');
      }
      const next: AssignNotif[] = actions.map((a) => ({
        id: a.id,
        customerName: (a.check_in_id ? ciMap.get(a.check_in_id) : null) ?? '고객',
        staffName: (a.to_staff_id ? staffMap.get(a.to_staff_id) : null) ?? '담당자',
        createdAt: a.created_at,
      }));
      setNotifs(next);
      // 읽음 set 정리: 더 이상 보이지 않는(어제분 등) id 는 가지치기
      setReadIds((prev) => {
        const valid = new Set([...prev].filter((id) => next.some((n) => n.id === id)));
        if (valid.size !== prev.size) persistReadIds(profile?.id, valid);
        return valid.size !== prev.size ? valid : prev;
      });
    } catch {
      /* best-effort: 알림 로드 실패가 화면을 막지 않음 */
    }
  }, [clinicId, profile?.id]);

  // 최초 + 폴링 fallback + realtime
  useEffect(() => {
    if (!clinicId) return;
    fetchNotifs();
    const poll = setInterval(fetchNotifs, POLL_MS);
    const channel = supabase
      .channel(`assign_notify_${clinicId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assignment_actions', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as { action_type?: string; reason?: string | null };
          // 재진 지정담당 정상배정(sentinel)은 알림 비대상 → 불필요한 refetch flash 방지.
          if (row?.action_type === 'auto_assign' && row?.reason !== ASSIGN_SILENT_REASON) {
            fetchNotifs();
          }
        },
      )
      .subscribe();
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [clinicId, fetchNotifs]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const unreadNotifs = useMemo(
    () => notifs.filter((n) => !readIds.has(n.id)),
    [notifs, readIds],
  );
  const unreadCount = unreadNotifs.length;

  // ── 전광판(마키) 텍스트 — 미읽음 배정 내역을 한 줄로 이어붙임 (AC-2) ─────────────
  //   reduced-motion 폴백에서도 의미가 전달되도록 머리에 요약(N건)을 둔다.
  const marqueeText = useMemo(() => {
    if (unreadCount === 0) return '';
    const head = `담당자 배정 알림 ${unreadCount}건`;
    const items = unreadNotifs
      .slice(0, 10)
      .map((n) => `${n.customerName} → ${n.staffName} 배정`)
      .join('  ·  ');
    return items ? `${head}  ·  ${items}` : head;
  }, [unreadCount, unreadNotifs]);

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persistReadIds(profile?.id, next);
        return next;
      });
    },
    [profile?.id],
  );

  const markAllRead = useCallback(() => {
    setReadIds(() => {
      const next = new Set(notifs.map((n) => n.id));
      persistReadIds(profile?.id, next);
      return next;
    });
  }, [notifs, profile?.id]);

  return (
    <div className="relative flex min-w-0 shrink items-center gap-1.5" ref={wrapRef}>
      {/* T-20260629-foot-ASSIGN-ALERT-MARQUEE AC-2/AC-3: 미읽음 배정 알림이 있을 때만(상시 X)
          전광판(마키) 스트립을 노출. 클릭 시 종 드롭다운 토글(노출 내용 동일).
          순수 CSS animation(tailwind keyframes) — 신규 npm 패키지 0.
          prefers-reduced-motion: motion-safe:* 변형으로 흐름/글로우 미적용 + motion-reduce:truncate 정적 강조 폴백.
          T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE [변경1 반응형]: 날짜선택 옆(혼잡한 대시보드 헤더)로 이동하며
            max-width를 태블릿 보수적으로 조정 — md(태블릿 세로 ~768)는 sm 캡(170) 유지, lg/xl(가로·데스크탑)에서만 확장.
            min-w-0 + shrink로 잔여 폭 부족 시 스트립이 밀려나지 않고 줄어들도록(마키=스크롤 티커라 내용 손실 없음). */}
      {unreadCount > 0 && (
        <button
          type="button"
          data-testid="assign-notify-marquee"
          onClick={() => setOpen((v) => !v)}
          title="담당자 배정 알림 — 클릭하여 상세 보기"
          aria-label={`담당자 배정 알림 ${unreadCount}건`}
          className="flex min-h-[36px] min-w-0 shrink max-w-[120px] items-center gap-1.5 overflow-hidden rounded-full border-2 border-amber-400 bg-amber-50 py-1 pl-2 pr-2.5 text-amber-800 transition hover:bg-amber-100 motion-safe:animate-alert-glow sm:max-w-[170px] lg:max-w-[280px] xl:max-w-[360px]"
        >
          <Megaphone className="h-4 w-4 shrink-0 text-amber-600 motion-safe:animate-pulse-hand" />
          <span className="min-w-0 flex-1 overflow-hidden">
            <span className="flex w-max whitespace-nowrap text-xs font-semibold motion-safe:animate-marquee motion-reduce:w-full motion-reduce:truncate">
              <span>{marqueeText}</span>
              {/* seamless loop용 복제본 — reduced-motion 시 숨김 */}
              <span aria-hidden className="pl-12 motion-reduce:hidden">{marqueeText}</span>
            </span>
          </span>
        </button>
      )}
      <button
        type="button"
        data-testid="assign-notify-bell"
        onClick={() => setOpen((v) => !v)}
        className="relative flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border bg-muted/50 px-2 py-1.5 text-muted-foreground transition hover:bg-muted"
        title="자동배정 알림"
        aria-label={`자동배정 알림 ${unreadCount}건`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            data-testid="assign-notify-count"
            className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-tight text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="assign-notify-panel"
          className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border bg-background shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">자동배정 알림</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="assign-notify-readall"
                onClick={markAllRead}
                disabled={unreadCount === 0}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                title="모두 읽음"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                모두 읽음
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground transition hover:bg-muted"
                aria-label="닫기"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-auto p-1">
            {notifs.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                오늘 자동배정 알림이 없습니다
              </div>
            ) : (
              notifs.map((n) => {
                const isUnread = !readIds.has(n.id);
                return (
                  <button
                    type="button"
                    key={n.id}
                    data-testid="assign-notify-item"
                    data-unread={isUnread ? 'true' : 'false'}
                    onClick={() => markRead(n.id)}
                    className={
                      'flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm transition hover:bg-muted ' +
                      (isUnread ? 'bg-blue-50/70' : '')
                    }
                  >
                    {isUnread && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    )}
                    <span className="flex-1 leading-snug">
                      <span className="font-medium">{n.customerName}</span>
                      <span className="text-muted-foreground"> 고객 → </span>
                      <span className="font-medium text-blue-700">{n.staffName}</span>
                      <span className="text-muted-foreground"> 배정됨</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {(() => {
                        try {
                          return format(new Date(n.createdAt), 'HH:mm');
                        } catch {
                          return '';
                        }
                      })()}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
