// T-20260808-foot-PENCHART-AUTORECORD-VISITLOG-2CHART
// 펜차트(자동기록용) — 고객 방문일별 치료내역 자동 집계 로그 (READ-ONLY).
//
// ⚠ 네이밍 주의: foot 기존 '펜차트'(PenChartTab)는 손글씨 캔버스(펜/지우개/사진첨부)다.
//   본 컴포넌트의 '펜차트(자동기록용)'는 이름만 같고 방문 데이터에서 자동 생성되는
//   치료내역 로그로 성격이 완전히 다르다 — 기존 손글씨 펜차트를 재정의/대체하지 않는다(신규 추가).
//
// ⚠ interim(planner AC-3): 패키지내용 = 총 회수만 표기(예: "12회").
//   급여/비급여 회차 split("비N/가M")은 phase2(INSURANCE-SPLIT-PHASE2, DA CONSULT 대기)로 이관.
//
// 데이터 출처(전부 이미 CustomerChartPage 에 로드된 상태 재사용 — 신규 쿼리 0):
//   packages(총 회수) + package_sessions(session_date, status, performed_by→staff_name).
//
// 집계 로직 SSOT = @/lib/autoVisitLog (순수 함수, 단위 테스트 대상). 본 컴포넌트는 표시 전용.

import { useMemo } from 'react';
import { formatDateDots } from '@/lib/format';
import {
  buildAutoVisitLogRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '@/lib/autoVisitLog';

export function AutoVisitLogTab({
  packages,
  packageSessions,
}: {
  packages: AutoVisitLogPackage[];
  packageSessions: AutoVisitLogSession[];
}) {
  const rows = useMemo(
    () => buildAutoVisitLogRows(packages, packageSessions),
    [packages, packageSessions],
  );

  return (
    <div className="space-y-3" data-testid="auto-visit-log-tab-content">
      <div className="rounded-lg border bg-white p-3 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-sage-800 mb-2">
          <span className="h-2 w-2 rounded-full bg-sage-500" />
          펜차트(자동기록용)
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            방문일별 치료내역 자동 기록 · 읽기전용
          </span>
        </div>

        {rows.length === 0 ? (
          <div
            className="py-6 text-center text-muted-foreground border border-dashed rounded"
            data-testid="auto-visit-log-empty"
          >
            기록 없음
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-testid="auto-visit-log-table">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">일자</th>
                  <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">패키지내용</th>
                  <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">금일 치료 횟수</th>
                  <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">차감치료사</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    className="border-b border-muted/20 hover:bg-sage-50/40"
                    data-testid="auto-visit-log-row"
                  >
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">
                      {formatDateDots(r.date)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.packageContent}</td>
                    <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{r.todayCount}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.therapists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
