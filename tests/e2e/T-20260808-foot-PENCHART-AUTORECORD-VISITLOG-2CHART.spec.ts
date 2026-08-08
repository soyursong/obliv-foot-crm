import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  buildAutoVisitLogRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260808-foot-PENCHART-AUTORECORD-VISITLOG-2CHART
 * 2번차트(고객상세) '펜차트(자동기록용)' 신설 — 방문일별 치료내역 자동 집계 로그 (READ-ONLY).
 *
 * ★interim 범위(planner AC-3, 2026-08-08): 패키지내용 = 총 회수만 표기(예: "12회").
 *   급여/비급여 회차 split("비N/가M")은 phase2(T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2,
 *   DA CONSULT MSG-20260808-233719-paig 대기)로 이관 — 본 spec 은 interim 만 검증.
 *
 * AC-1: 2번차트에 '펜차트(자동기록용)' 섹션/탭 신설, 방문 이력 있는 날마다 1행씩 자동 렌더.
 * AC-2: 각 행 [일자][패키지내용(함축)][금일 치료 횟수][차감치료사] 4열.
 * AC-3(interim): 패키지내용 = 총회차 표기("12회"). 비/가 split 없음(phase2).
 * AC-4: 금일 치료 횟수 = "{총회수}-{당일차감횟수}"(예: "12-1").
 * AC-5: 차감치료사 = 당일 package_sessions.performed_by 치료사.
 * AC-6: READ-ONLY — 신규 쿼리/write 없음, 이미 로드된 packages·packageSessions 재사용.
 * AC-7: 기존 손글씨 펜차트(PenChartTab) 무접촉(신규 추가만).
 *
 * FE-only, 스키마 무접촉(db_change=false). 실 렌더는 supervisor 표준 FE QA.
 * 순수 로직(buildAutoVisitLogRows) 단위검증 + 소스 가드 — auth/server/page 불요.
 */

// ── 픽스처 ───────────────────────────────────────────────────────────────
const PKG_12: AutoVisitLogPackage = { id: 'pkg-12', total_sessions: 12 };
const PKG_5: AutoVisitLogPackage = { id: 'pkg-5', total_sessions: 5 };

function sess(
  p: Partial<AutoVisitLogSession> & Pick<AutoVisitLogSession, 'package_id' | 'session_date'>,
): AutoVisitLogSession {
  return { status: 'used', staff_name: null, ...p };
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 정상 동선 (AC-1·AC-2·AC-3 interim·AC-4·AC-5)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T-20260808-PENCHART-AUTORECORD — 방문일별 자동 집계 (순수 로직)', () => {
  test('AC-1/AC-2: 방문 이력 있는 날마다 1행, 4열 채워짐', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-05', staff_name: '지민' }),
      ],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.date).toBeTruthy();
      expect(r.packageContent).toBeTruthy();
      expect(r.todayCount).toBeTruthy();
      expect(r.therapists).toBeTruthy();
    }
  });

  test('AC-3 interim: 패키지내용 = 총회차만("12회") — 비/가 split 없음(phase2)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' })],
    );
    expect(rows[0].packageContent).toBe('12회');
    // interim: 급여/비급여 축약(비N/가M) 미포함
    expect(rows[0].packageContent).not.toContain('비');
    expect(rows[0].packageContent).not.toContain('가');
  });

  test('AC-4: 금일 치료 횟수 = "{총회수}-{당일차감횟수}" (12-1)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' })],
    );
    expect(rows[0].todayCount).toBe('12-1');
  });

  test('AC-5: 차감치료사 = 당일 수행 치료사(performed_by→staff_name)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' })],
    );
    expect(rows[0].therapists).toBe('혜인');
  });

  test('정렬: 최신순(session_date DESC)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-01' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-05' }),
      ],
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-08-08', '2026-08-05', '2026-08-01']);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 시나리오 2 — 엣지 케이스
  // ═════════════════════════════════════════════════════════════════════════
  test('엣지1: 방문 이력 없음 → 빈 배열(빈 상태 "기록 없음")', () => {
    expect(buildAutoVisitLogRows([PKG_12], [])).toEqual([]);
  });

  test('엣지2: 같은 날 2회 차감 → 1행에 집계, 금일치료횟수=12-2, 치료사 복수 병기', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '지민' }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('12-2');
    expect(rows[0].therapists).toBe('혜인, 지민');
  });

  test('엣지2-b: 같은 날 같은 치료사 2회 → 치료사 중복 제거(단일 표기)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_5],
      [
        sess({ package_id: 'pkg-5', session_date: '2026-08-08', staff_name: '혜인' }),
        sess({ package_id: 'pkg-5', session_date: '2026-08-08', staff_name: '혜인' }),
      ],
    );
    expect(rows[0].todayCount).toBe('5-2');
    expect(rows[0].therapists).toBe('혜인');
  });

  test('엣지3: 패키지 미매칭 → 크래시 없이 안전 렌더("-")', () => {
    const rows = buildAutoVisitLogRows(
      [], // packages 없음
      [sess({ package_id: 'pkg-unknown', session_date: '2026-08-08', staff_name: '혜인' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].packageContent).toBe('-');
    expect(rows[0].therapists).toBe('혜인');
  });

  test('취소/환불 회차는 치료(차감) 아님 — 집계 제외', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', status: 'cancelled', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', status: 'refunded', staff_name: '지민' }),
      ],
    );
    expect(rows).toEqual([]);
  });

  test('차감치료사 미상(performed_by null) → "-"', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: null })],
    );
    expect(rows[0].therapists).toBe('-');
  });

  test('다중 패키지: (일자,패키지) grain 으로 분리 렌더', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12, PKG_5],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' }),
        sess({ package_id: 'pkg-5', session_date: '2026-08-08', staff_name: '지민' }),
      ],
    );
    expect(rows).toHaveLength(2);
    const contents = rows.map((r) => r.packageContent).sort();
    expect(contents).toEqual(['12회', '5회']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 소스 가드 — 배선/무접촉 정적 검증 (AC-1·AC-6·AC-7)
// ═══════════════════════════════════════════════════════════════════════════
const CHART_PAGE = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');
const TAB = fs.readFileSync(path.resolve('src/components/AutoVisitLogTab.tsx'), 'utf-8');

test.describe('T-20260808-PENCHART-AUTORECORD — 배선/무접촉 소스 가드', () => {
  test('AC-1: CLINICAL_TABS 에 auto_visit_log 탭(라벨 "펜차트(자동기록용)") 등록', () => {
    expect(CHART_PAGE).toMatch(/key:\s*'auto_visit_log'.*label:\s*'펜차트\(자동기록용\)'/);
    expect(CHART_PAGE).toMatch(/IMPLEMENTED_CLINICAL\s*=\s*\[[^\]]*'auto_visit_log'/);
  });

  test('AC-1: auto_visit_log 탭 콘텐츠에 <AutoVisitLogTab/> 마운트(packages·packageSessions 주입)', () => {
    expect(CHART_PAGE).toMatch(/chartTab === 'auto_visit_log'/);
    expect(CHART_PAGE).toMatch(/<AutoVisitLogTab\s+packages=\{packages\}\s+packageSessions=\{packageSessions\}/);
  });

  test('AC-6: READ-ONLY — 컴포넌트에 write(insert/update/delete/upsert) 호출 없음', () => {
    expect(TAB).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    // 신규 supabase 쿼리 없음 — 이미 로드된 props 만 사용
    expect(TAB).not.toMatch(/supabase\.from\(/);
  });

  test('AC-7: 기존 손글씨 펜차트(PenChartTab) 무접촉 — 별개 신규 컴포넌트', () => {
    // 신규 탭 마운트가 기존 pen_chart 탭(PenChartTab) 렌더를 대체하지 않음(둘 다 존재)
    expect(CHART_PAGE).toMatch(/chartTab === 'pen_chart'/);
    expect(CHART_PAGE).toMatch(/<PenChartTab/);
    expect(CHART_PAGE).toMatch(/chartTab === 'auto_visit_log'/);
  });
});
