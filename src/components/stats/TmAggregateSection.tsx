import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { seoulISODate } from '@/lib/format';
import {
  tmCounselorLabel,
  TM_UNASSIGNED_LABEL,
  TM_WALKIN_LABEL,
  type TmAggregateData,
  type TmResRow,
  type TmCheckInRow,
} from '@/lib/stats';

/**
 * T-20260610-foot-STATS-TM-AGGREGATE-TAB
 * 롱래CRM AdminStats TM 탭 산식을 SSOT로 차용한 풋 TM집계 섹션.
 * 풋 통계 톤앤매너(Card / teal-emerald / tabular-nums) 적용.
 *
 * 집계 정의(롱래 동일):
 *  - 예약등록건수: 기간 내 예약 추가 수
 *  - 예약수: 기간 내 잡혀있는 예약(취소 포함)
 *  - 내원건수: 기간 내 실제 내원 수(이탈 포함, 취소 제외)
 *  - 내원률: 내원수 ÷ 예약수
 *  - TM(상담사) 귀속: reservations.created_by(=user_profiles.id)
 */

interface Props {
  data: TmAggregateData | null;
  loading: boolean;
  currentUserId: string | null;
  rangeFrom: string;
  rangeTo: string;
}

type KpiKey = 'registered' | 'scheduled' | 'visited';

// 라벨 SSOT = @/lib/stats (tmCounselorLabel + 상수). provenance 가드 주석은 그쪽에 위치.
const UNASSIGNED = TM_UNASSIGNED_LABEL;
const WALKIN = TM_WALKIN_LABEL;

export default function TmAggregateSection({
  data,
  loading,
  currentUserId,
  rangeFrom,
  rangeTo,
}: Props) {
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyTmRole, setOnlyTmRole] = useState(false);
  const [kpiDetail, setKpiDetail] = useState<KpiKey | null>(null);

  const registeredRes = data?.registered ?? [];
  const scheduledRes = data?.scheduled ?? [];
  const visitedCI = data?.visited ?? [];
  const staffMap = data?.staffMap ?? {};

  // 예약 id → 예약 row (내원의 TM/내원일 역참조)
  const allResMap = useMemo(() => {
    const m = new Map<string, TmResRow>();
    [...registeredRes, ...scheduledRes].forEach((r) => m.set(r.id, r));
    return m;
  }, [registeredRes, scheduledRes]);

  // TM 귀속 (롱래 tmOfRes / tmOfCheckIn 차용)
  const tmOfRes = (r: TmResRow) => r.created_by || UNASSIGNED;
  const tmOfCheckIn = (ci: TmCheckInRow) => {
    if (ci.reservation_id && allResMap.has(ci.reservation_id)) {
      return allResMap.get(ci.reservation_id)!.created_by || UNASSIGNED;
    }
    return WALKIN; // 풋 check_ins엔 created_by 없음 → 매칭 예약 없으면 워크인
  };

  // 표시 라벨(provenance-aware). 상담사(created_by)가 매칭되는 풋 직원이면 직원명,
  // NULL/미매칭이면서 도파민 ingest 예약이면 도파민/TM 유입 라벨, 그 외 미지정.
  // (필터용 tmOfRes/tmOfCheckIn 은 raw uid 유지 — onlyMine/TM팀만 의미 보존.)
  const labelForRes = (r: TmResRow): string =>
    tmCounselorLabel(r.created_by, r.source_system, staffMap[r.created_by ?? '']?.name);
  const labelForCheckIn = (ci: TmCheckInRow): string => {
    const matched = ci.reservation_id ? allResMap.get(ci.reservation_id) : undefined;
    if (!matched) return WALKIN;
    return labelForRes(matched);
  };
  const isTm = (uid: string) => staffMap[uid]?.role === 'tm';

  const isMyRecord = (uid: string | null) => !!uid && !!currentUserId && uid === currentUserId;

  // "내 예약만" 필터
  const filteredRegistered = useMemo(
    () => (onlyMine ? registeredRes.filter((r) => isMyRecord(r.created_by)) : registeredRes),
    [registeredRes, onlyMine, currentUserId],
  );
  const filteredScheduled = useMemo(
    () => (onlyMine ? scheduledRes.filter((r) => isMyRecord(r.created_by)) : scheduledRes),
    [scheduledRes, onlyMine, currentUserId],
  );
  const filteredVisited = useMemo(
    () => (onlyMine ? visitedCI.filter((ci) => isMyRecord(tmOfCheckIn(ci))) : visitedCI),
    [visitedCI, onlyMine, currentUserId, allResMap],
  );

  // "TM팀만" 필터 (role='tm')
  const tmFilteredRegistered = useMemo(
    () => (onlyTmRole ? filteredRegistered.filter((r) => isTm(tmOfRes(r))) : filteredRegistered),
    [filteredRegistered, onlyTmRole, staffMap],
  );
  const tmFilteredScheduled = useMemo(
    () => (onlyTmRole ? filteredScheduled.filter((r) => isTm(tmOfRes(r))) : filteredScheduled),
    [filteredScheduled, onlyTmRole, staffMap],
  );
  const tmFilteredVisited = useMemo(
    () => (onlyTmRole ? filteredVisited.filter((ci) => isTm(tmOfCheckIn(ci))) : filteredVisited),
    [filteredVisited, onlyTmRole, staffMap, allResMap],
  );

  const totals = useMemo(() => {
    const registered = tmFilteredRegistered.length;
    const scheduled = tmFilteredScheduled.length;
    const visited = tmFilteredVisited.length;
    const visitRate = scheduled > 0 ? (visited / scheduled) * 100 : 0;
    return { registered, scheduled, visited, visitRate };
  }, [tmFilteredRegistered, tmFilteredScheduled, tmFilteredVisited]);

  // TM상담사별 집계 — 표시 라벨 기준 합산 + 내원율 (롱래 tmStats 차용)
  // 표시 라벨(provenance-aware)로 직접 집계 → 같은 라벨끼리 병합.
  const tmStats = useMemo(() => {
    const map = new Map<string, { tm: string; registered: number; scheduled: number; visited: number }>();
    const ensure = (tm: string) => {
      if (!map.has(tm)) map.set(tm, { tm, registered: 0, scheduled: 0, visited: 0 });
      return map.get(tm)!;
    };
    tmFilteredRegistered.forEach((r) => (ensure(labelForRes(r)).registered += 1));
    tmFilteredScheduled.forEach((r) => (ensure(labelForRes(r)).scheduled += 1));
    tmFilteredVisited.forEach((ci) => (ensure(labelForCheckIn(ci)).visited += 1));

    return Array.from(map.values())
      .map((r) => ({ ...r, visitRate: r.scheduled > 0 ? (r.visited / r.scheduled) * 100 : 0 }))
      .sort((a, b) => b.registered - a.registered);
  }, [tmFilteredRegistered, tmFilteredScheduled, tmFilteredVisited, staffMap, allResMap]);

  // 채널별 유입 — 풋: 내원의 matched 예약 referral_source 역참조 (롱래 referral_source 차용)
  const channelStats = useMemo(() => {
    const map = new Map<string, number>();
    tmFilteredVisited.forEach((ci) => {
      const res = ci.reservation_id ? allResMap.get(ci.reservation_id) : undefined;
      const src = res?.referral_source || '미분류';
      map.set(src, (map.get(src) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [tmFilteredVisited, allResMap]);

  // KPI 드릴다운 상세 행 (롱래 detailRows 차용, 6컬럼)
  type DetailRow = { registeredDate: string; reservationDate: string; reservationTime: string; visitDate: string; name: string; phone: string; tm: string; groupKey: string };
  const detailRows = useMemo<DetailRow[]>(() => {
    if (!kpiDetail) return [];
    const resIdToVisit = new Map<string, string>();
    visitedCI.forEach((ci) => {
      const vd = ci.created_date || (ci.checked_in_at ? seoulISODate(ci.checked_in_at) : '');
      if (ci.reservation_id && vd) resIdToVisit.set(ci.reservation_id, vd);
    });

    const mapRes = (r: TmResRow): DetailRow => {
      const info = r.customers || { name: '', phone: '' };
      const regDate = r.created_at ? String(r.created_at).slice(0, 10) : '';
      const resTime = r.reservation_time ? String(r.reservation_time).slice(0, 5) : '';
      return {
        registeredDate: regDate,
        reservationDate: r.reservation_date || '',
        reservationTime: resTime,
        visitDate: resIdToVisit.get(r.id) || '',
        name: info.name || '',
        phone: info.phone || '',
        tm: labelForRes(r),
        groupKey: kpiDetail === 'registered' ? regDate : r.reservation_date || '',
      };
    };
    const mapCI = (ci: TmCheckInRow): DetailRow => {
      const info = ci.customers || { name: '' };
      const matched = ci.reservation_id ? allResMap.get(ci.reservation_id) : undefined;
      const regDate = matched?.created_at ? String(matched.created_at).slice(0, 10) : '';
      const resTime = matched?.reservation_time ? String(matched.reservation_time).slice(0, 5) : '';
      const visit = ci.created_date || (ci.checked_in_at ? seoulISODate(ci.checked_in_at) : '');
      return {
        registeredDate: regDate,
        reservationDate: matched?.reservation_date || '',
        reservationTime: resTime,
        visitDate: visit,
        name: info.name || '',
        phone: '',
        tm: labelForCheckIn(ci),
        groupKey: visit,
      };
    };
    const rows =
      kpiDetail === 'registered' ? tmFilteredRegistered.map(mapRes)
      : kpiDetail === 'scheduled' ? tmFilteredScheduled.map(mapRes)
      : tmFilteredVisited.map(mapCI);
    return rows.sort((a, b) => (a.groupKey + a.reservationTime).localeCompare(b.groupKey + b.reservationTime));
  }, [kpiDetail, tmFilteredRegistered, tmFilteredScheduled, tmFilteredVisited, visitedCI, allResMap, staffMap]);

  const kpiTitle = (k: KpiKey) => (k === 'registered' ? '예약등록건수' : k === 'scheduled' ? '예약수' : '내원건수');

  const downloadCsv = () => {
    const headers = ['예약등록일', '예약일', '예약시간', '내원일', '고객명', '핸드폰번호', 'TM상담사'];
    const lines = [headers.join(',')];
    detailRows.forEach((r) => {
      const cells = [r.registeredDate, r.reservationDate, r.reservationTime, r.visitDate, r.name, r.phone, r.tm]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TM집계_${kpiDetail ? kpiTitle(kpiDetail) : ''}_${rangeFrom}_${rangeTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">TM집계</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyMine((v) => !v)}
            title="본인이 등록한 예약·내원만 보기"
            className={
              onlyMine
                ? 'bg-teal-600 text-white px-3 py-1 rounded-md text-xs font-medium'
                : 'border text-muted-foreground hover:bg-muted px-3 py-1 rounded-md text-xs font-medium transition'
            }
          >
            {onlyMine ? '✓ 내 예약만' : '내 예약만'}
          </button>
          <button
            type="button"
            onClick={() => setOnlyTmRole((v) => !v)}
            title="직책 TM(전화예약) 직원만 집계"
            className={
              onlyTmRole
                ? 'bg-teal-600 text-white px-3 py-1 rounded-md text-xs font-medium'
                : 'border text-muted-foreground hover:bg-muted px-3 py-1 rounded-md text-xs font-medium transition'
            }
          >
            {onlyTmRole ? '✓ TM팀만' : 'TM팀만'}
          </button>
        </div>
      </div>

      {/* KPI 요약 — 숫자 클릭 시 상세 팝업 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setKpiDetail('registered')}
          className="bg-card border rounded-lg p-4 text-left hover:bg-muted/30 transition-colors"
        >
          <div className="text-xs text-muted-foreground">예약등록건수</div>
          <div className="text-2xl font-bold mt-1 underline decoration-dotted tabular-nums">{totals.registered.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-1">해당 기간에 예약 추가한 수</div>
        </button>
        <button
          type="button"
          onClick={() => setKpiDetail('scheduled')}
          className="bg-card border rounded-lg p-4 text-left hover:bg-muted/30 transition-colors"
        >
          <div className="text-xs text-muted-foreground">예약수</div>
          <div className="text-2xl font-bold mt-1 text-blue-600 underline decoration-dotted tabular-nums">{totals.scheduled.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-1">해당 기간에 잡혀있는 전체 예약 (취소 포함)</div>
        </button>
        <button
          type="button"
          onClick={() => setKpiDetail('visited')}
          className="bg-card border rounded-lg p-4 text-left hover:bg-muted/30 transition-colors"
        >
          <div className="text-xs text-muted-foreground">내원건수</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600 underline decoration-dotted tabular-nums">{totals.visited.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-1">해당 기간에 내원한 수 (이탈 포함)</div>
        </button>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">내원률</div>
          <div className="text-2xl font-bold mt-1 text-violet-600 tabular-nums">{totals.visitRate.toFixed(2)}%</div>
          <div className="text-[10px] text-muted-foreground mt-1">내원수 ÷ 예약수</div>
        </div>
      </div>

      {/* 채널별 유입 */}
      {channelStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">채널별 유입 (예약경로)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {channelStats.map(({ name, count }) => {
                const maxCount = channelStats[0]?.count || 1;
                const pct = tmFilteredVisited.length > 0 ? (count / tmFilteredVisited.length) * 100 : 0;
                return (
                  <div key={name} className="flex items-center gap-3 text-sm">
                    <span className="w-24 text-right text-muted-foreground truncate shrink-0" title={name}>{name}</span>
                    <div className="flex-1 h-6 bg-muted/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-teal-500/70 rounded flex items-center px-2"
                        style={{ width: `${Math.max((count / maxCount) * 100, 8)}%` }}
                      >
                        <span className="text-xs text-white font-medium whitespace-nowrap">{count}건</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground w-14 text-right shrink-0">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* TM상담사별 집계 테이블 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">TM상담사별 집계</CardTitle>
          {loading && <span className="text-xs text-muted-foreground">로딩 중…</span>}
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-2 font-medium text-left">TM 상담사 (등록자)</th>
                  <th className="pb-2 font-medium text-right">예약등록건수</th>
                  <th className="pb-2 font-medium text-right">예약수</th>
                  <th className="pb-2 font-medium text-right">내원건수</th>
                  <th className="pb-2 font-medium text-right">내원율</th>
                </tr>
              </thead>
              <tbody>
                {tmStats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">데이터 없음</td>
                  </tr>
                ) : (
                  tmStats.map((row) => (
                    <tr key={row.tm} className="border-b last:border-0 hover:bg-muted/10">
                      <td className="py-2 font-medium">{row.tm}</td>
                      <td className="py-2 text-right tabular-nums">{row.registered.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-blue-600 font-medium">{row.scheduled.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-600 font-medium">{row.visited.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-violet-600 font-medium">{row.visitRate.toFixed(1)}%</td>
                    </tr>
                  ))
                )}
              </tbody>
              {tmStats.length > 0 && (
                <tfoot className="border-t-2 font-semibold text-sm">
                  <tr>
                    <td className="py-2">합계</td>
                    <td className="py-2 text-right tabular-nums">{totals.registered.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-blue-600">{totals.scheduled.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">{totals.visited.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-violet-600">{totals.visitRate.toFixed(1)}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground px-1">
        * 예약등록건수는 예약을 추가한 날짜 기준, 예약수는 예약이 잡혀있는 날짜 기준, 내원건수는 실제 체크인한 날짜 기준으로 집계합니다.
        <br />
        * 대기후이탈 등 내원 이후 이탈 건도 내원건수에 포함됩니다(취소 제외).
      </p>

      {/* KPI 숫자 클릭 → 상세 팝업 + CSV 다운로드 */}
      <Dialog open={!!kpiDetail} onOpenChange={(v) => { if (!v) setKpiDetail(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {kpiDetail ? kpiTitle(kpiDetail) : ''} ({detailRows.length.toLocaleString()}건)
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-muted-foreground">{rangeFrom} ~ {rangeTo}</span>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={detailRows.length === 0}
              className="border rounded-md px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              CSV 다운로드
            </button>
          </div>
          <div className="max-h-[60vh] overflow-auto border rounded">
            {detailRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">데이터 없음</div>
            ) : (() => {
              const groups = new Map<string, DetailRow[]>();
              detailRows.forEach((r) => {
                const k = r.groupKey || '-';
                (groups.get(k) || groups.set(k, []).get(k)!).push(r);
              });
              const groupLabel = kpiDetail === 'registered' ? '예약등록일' : kpiDetail === 'scheduled' ? '예약일' : '내원일';
              return Array.from(groups.entries()).map(([date, rows]) => (
                <div key={date}>
                  <div className="sticky top-0 bg-muted/80 backdrop-blur text-xs font-semibold px-3 py-1.5 border-b">
                    {groupLabel} {date} <span className="text-muted-foreground font-normal ml-2">{rows.length}건</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20 text-[10px] text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-1 w-24">예약등록일</th>
                        <th className="text-left px-2 py-1 w-24">예약일</th>
                        <th className="text-left px-2 py-1 w-16">예약시간</th>
                        <th className="text-left px-2 py-1 w-24">내원일</th>
                        <th className="text-left px-2 py-1">고객명</th>
                        <th className="text-left px-2 py-1">핸드폰번호</th>
                        <th className="text-left px-2 py-1">TM상담사</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${date}-${i}`} className="border-t hover:bg-muted/10">
                          <td className="px-2 py-1 text-muted-foreground">{r.registeredDate}</td>
                          <td className="px-2 py-1">{r.reservationDate}</td>
                          <td className="px-2 py-1">{r.reservationTime}</td>
                          <td className="px-2 py-1 text-emerald-700">{r.visitDate}</td>
                          <td className="px-2 py-1 font-medium">{r.name}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.phone}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.tm}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ));
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
