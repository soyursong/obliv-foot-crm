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

// T-20260630-foot-DASH-HEADER-DEDUP-COMPACT AC-1: 대시보드 헤더에서 '종 아이콘' 제거 요청.
//   마키 스트립(클릭=드롭다운 토글)이 이미 알림 진입점이라 종 버튼은 중복 → showBell={false}로 숨김.
//   기본값 true 유지 → 예약관리(Reservations) 등 기존 사용처는 동작 불변(스코프 격리).
export default function AssignmentNotifyBell({
  clinicId,
  showBell = true,
}: {
  clinicId: string | null;
  showBell?: boolean;
}) {
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

  // ── 세로 전광판(마키-Y) 라인 — 미읽음 배정 내역을 '줄 단위'로 (AC-3) ─────────────
  //   요약(N건)을 머리 줄에 둬 reduced-motion 정적 폴백에서도 의미가 전달되도록 한다.
  const lines = useMemo(() => {
    if (unreadCount === 0) return [] as string[];
    const head = `담당자 배정 알림 ${unreadCount}건`;
    const items = unreadNotifs
      .slice(0, 10)
      .map((n) => `${n.customerName} → ${n.staffName} 배정`);
    return [head, ...items];
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
      {/* T-20260630-foot-ASSIGN-ALERT-COMPACT-MONO-VERTICAL: 미읽음 배정 알림이 있을 때만(상시 X)
          전광판 스트립을 노출. 클릭 시 종 드롭다운 토글(노출 내용 동일 — 위치·내용·조건 무변경).
          ▸ AC-1 컴팩트: 높이/패딩/폰트 축소(36→24px대, text-xs→[11px]) — '딱 알아볼 최소 크기'.
          ▸ AC-2 모노톤: amber 강조색 전면 제거 → 그레이스케일 단색(border/bg/text 모두 gray).
          ▸ AC-3 세로 흐름: 가로 marquee → '세로 마키-Y' 티커(라인 2벌 seamless, 위→아래 흐름).
          순수 CSS animation(tailwind keyframes) — 신규 npm 패키지 0.
          prefers-reduced-motion: motion-safe:* 변형으로 흐름 미적용 + motion-reduce 정적 요약줄 폴백.
          [반응형] 날짜선택 옆 배치 유지 — max-width 보수적 캡(md=sm 캡 유지, lg/xl 확장).
            min-w-0 + shrink로 잔여 폭 부족 시 스트립이 줄어들도록(티커라 내용 손실 없음). */}
      {unreadCount > 0 && (
        <button
          type="button"
          data-testid="assign-notify-marquee"
          onClick={() => setOpen((v) => !v)}
          title="담당자 배정 알림 — 클릭하여 상세 보기"
          aria-label={`담당자 배정 알림 ${unreadCount}건`}
          // T-20260701-foot-LIVESLOT-GLASS-APPLY surface B(대시보드 상단 전광판): v2 컨펌 시안 정식 적용.
          //   반투명 유리 볼록(.live-glass-board: backdrop-blur + inset/outer box-shadow) + 연한 실버 테두리
          //   (border-[#C7CDD4]) + 테두리 깜빡(live-border-pulse, 점등/소등 2위상). 볼록 box-shadow는 비애니메이션
          //   → 소등 위상에서도 볼록감 유지. 힐러 노랑(#FFFDE7) 미접촉(무채색 실버). 기존 gray-100/300 대체.
          className="live-glass-board flex min-h-[24px] min-w-0 shrink max-w-[120px] items-center gap-1 overflow-hidden rounded-md border-2 border-[#C7CDD4] py-0.5 pl-1.5 pr-2 text-gray-700 transition hover:brightness-[1.03] motion-safe:animate-live-border-pulse sm:max-w-[170px] lg:max-w-[280px] xl:max-w-[360px]"
        >
          <Megaphone className="h-3 w-3 shrink-0 text-gray-500" />
          {/* 세로 티커 창: 한 줄 높이(16px)만 보이고 라인이 위로 흐른다 */}
          <span className="relative block h-4 min-w-0 flex-1 overflow-hidden text-[11px] font-medium leading-4">
            {/* reduced-motion 정적 폴백 — 요약(첫 줄)만 노출 */}
            <span className="hidden truncate motion-reduce:block">{lines[0]}</span>
            {/* 세로 마키-Y — 라인 2벌 seamless 흐름(motion-safe), reduced-motion 시 숨김 */}
            <span className="flex flex-col motion-reduce:hidden motion-safe:animate-marquee-y">
              {lines.map((t, i) => (
                <span key={`a-${i}`} className="block h-4 truncate whitespace-nowrap">{t}</span>
              ))}
              {lines.map((t, i) => (
                <span key={`b-${i}`} aria-hidden className="block h-4 truncate whitespace-nowrap">{t}</span>
              ))}
            </span>
          </span>
        </button>
      )}
      {/* T-20260630-foot-DASH-HEADER-DEDUP-COMPACT AC-1: 종(Bell) 버튼+미읽음 배지는 showBell일 때만.
          대시보드(showBell={false})에선 마키만 노출 — 드롭다운은 마키 클릭으로 진입. */}
      {showBell && (
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
      )}

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
