// T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC5:
//   예약상세 팝업의 "활성 패키지/치료내역" 표시를 2번차트(CustomerChartPage)의
//   "구매 패키지(티켓)" 탭 양식으로 통일하기 위한 read-only 표현 컴포넌트.
//   양식 출처(시각 1:1): CustomerChartPage.tsx 구매패키지(티켓) 섹션
//     - 카드 헤더: 패키지명 + 발행일(contract_date|created_at) + 상태 뱃지
//     - 총 금액
//     - 시술별 상세표: 시술명 · 수가(회당) · 총 횟수 · 사용 · 잔여
//     - 시술내역(차감 기록): 회차 · 시술명 · 날짜 · 담당자
//   ⚠ read-only — 추가/수정/삭제 버튼·다이얼로그 0 (팝업 chart2 read-only 관례). 신규 양식 발명 금지(2번차트 복제).
import { format } from 'date-fns';
import { formatAmount } from '@/lib/format';
import type { Package } from '@/lib/types';

export type PackageSessionRow = {
  id: string;
  package_id: string;
  session_number: number;
  session_type: string;
  session_date: string;
  status: string;
  staff_name: string | null;
};

// 2번차트 PKG_STATUS_KO / TREAT_KO 동일 매핑 (시각 일치)
const PKG_STATUS_KO: Record<string, string> = {
  active: '진행중',
  completed: '완료',
  cancelled: '취소',
  refunded: '환불',
  transferred: '양도',
};
const TREAT_KO: Record<string, string> = {
  heated_laser: '가열',
  unheated_laser: '비가열',
  podologue: '포돌로게',
  iv: '수액',
  preconditioning: '프컨',
  trial: '체험권',
  reborn: 'Re:Born',
};

export function PackageTicketReadonlyList({
  packages,
  sessions,
}: {
  packages: Package[];
  sessions: PackageSessionRow[];
}) {
  // 2번차트 동일: cancelled(soft delete) 비노출
  const visible = packages.filter((p) => p.status !== 'cancelled');
  if (visible.length === 0) {
    return <div className="text-xs text-muted-foreground italic py-1">패키지 없음</div>;
  }
  return (
    <div className="space-y-3">
      {visible.map((p) => {
        const usedSessions = sessions.filter((s) => s.package_id === p.id && s.status === 'used');
        const usedByType: Record<string, number> = {};
        usedSessions.forEach((s) => {
          usedByType[s.session_type] = (usedByType[s.session_type] || 0) + 1;
        });
        // 2번차트 PKG-DYNAMIC-TABLE: 기입된 시술만 행으로 (count>0 || unit_price>0)
        const treatRows = [
          ((p.unheated_sessions ?? 0) > 0 || (p.unheated_unit_price ?? 0) > 0) && {
            label: '비가열', qty: p.unheated_sessions ?? 0, unitPrice: p.unheated_unit_price ?? 0, used: usedByType['unheated_laser'] ?? 0,
          },
          ((p.heated_sessions ?? 0) > 0 || (p.heated_unit_price ?? 0) > 0) && {
            label: '가열', qty: p.heated_sessions ?? 0, unitPrice: p.heated_unit_price ?? 0, used: usedByType['heated_laser'] ?? 0,
          },
          ((p.podologe_sessions ?? 0) > 0 || (p.podologe_unit_price ?? 0) > 0) && {
            label: '포돌로게', qty: p.podologe_sessions ?? 0, unitPrice: p.podologe_unit_price ?? 0, used: usedByType['podologue'] ?? 0,
          },
          ((p.iv_sessions ?? 0) > 0 || (p.iv_unit_price ?? 0) > 0) && {
            label: `수액${p.iv_company ? ` (${p.iv_company})` : ''}`, qty: p.iv_sessions ?? 0, unitPrice: p.iv_unit_price ?? 0, used: usedByType['iv'] ?? 0,
          },
          ((p.trial_sessions ?? 0) > 0 || (p.trial_unit_price ?? 0) > 0) && {
            label: '체험권', qty: p.trial_sessions ?? 0, unitPrice: p.trial_unit_price ?? 0, used: usedByType['trial'] ?? 0,
          },
          ((p.reborn_sessions ?? 0) > 0 || (p.reborn_unit_price ?? 0) > 0) && {
            label: 'Re:Born', qty: p.reborn_sessions ?? 0, unitPrice: p.reborn_unit_price ?? 0, used: usedByType['reborn'] ?? 0,
          },
        ].filter(Boolean) as { label: string; qty: number; unitPrice: number; used: number }[];

        return (
          <div key={p.id} className="rounded-lg border border-muted/40 overflow-hidden">
            {/* 헤더: 패키지명 + 발행일 + 상태 뱃지 */}
            <div className="flex items-center justify-between bg-muted/20 px-3 py-1.5">
              <span className="text-xs font-semibold text-teal-800">{p.package_name}</span>
              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                {(p.contract_date || p.created_at) && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {p.contract_date
                      ? p.contract_date.slice(0, 10)
                      : format(new Date(p.created_at), 'yyyy-MM-dd')}
                  </span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    p.status === 'active'
                      ? 'bg-teal-100 text-teal-700'
                      : p.status === 'refunded'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {PKG_STATUS_KO[p.status] ?? p.status}
                </span>
              </div>
            </div>
            {/* 총 금액 */}
            <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-muted/10">
              총 금액:{' '}
              <span className="font-semibold text-teal-700 tabular-nums">{formatAmount(p.total_amount)}</span>
            </div>
            {/* 시술별 상세표 */}
            {treatRows.length > 0 && (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted/10 text-muted-foreground border-b border-muted/20">
                    <th className="text-left px-3 py-1 font-medium text-[10px]">시술명</th>
                    <th className="text-right px-2 py-1 font-medium text-[10px]">수가(회당)</th>
                    <th className="text-center px-2 py-1 font-medium text-[10px]">총 횟수</th>
                    <th className="text-center px-2 py-1 font-medium text-[10px] text-teal-700">사용</th>
                    <th className="text-center px-2 py-1 font-medium text-[10px] text-orange-600">잔여</th>
                  </tr>
                </thead>
                <tbody>
                  {treatRows.map((row) => (
                    <tr key={row.label} className="border-b border-muted/10 last:border-b-0">
                      <td className="px-3 py-1.5 font-medium text-[11px]">{row.label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                        {row.unitPrice > 0 ? formatAmount(row.unitPrice) : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-center text-[11px]">{row.qty}회</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-teal-700 text-[11px]">{row.used}회</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-orange-600 text-[11px]">
                        {row.qty - row.used}회
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* 시술내역 (회차 차감 기록): 회차 · 시술명 · 날짜 · 담당자 */}
            {usedSessions.length > 0 && (
              <div className="border-t border-muted/20 px-3 pb-2 pt-1.5">
                <div className="text-[10px] text-muted-foreground mb-1 font-medium">시술내역</div>
                {/* T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX AC2: 사용이력 10건+ 레이아웃 붕괴 수정.
                    영역 내부 스크롤(max-h + overflow-y-auto)로 카드 높이 폭주 차단 + 각 항목 1행 고정(nowrap·min-w-0·ellipsis). */}
                <div className="space-y-0.5 max-h-40 overflow-y-auto pr-0.5">
                  {usedSessions.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 text-[10px] rounded px-0.5 min-w-0 flex-nowrap whitespace-nowrap">
                      <span className="text-muted-foreground w-5 tabular-nums shrink-0">{s.session_number}회</span>
                      <span className="rounded bg-muted/40 px-1 shrink-0">{TREAT_KO[s.session_type] ?? s.session_type}</span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">{s.session_date}</span>
                      {s.staff_name && <span className="text-teal-600 truncate min-w-0">{s.staff_name}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
