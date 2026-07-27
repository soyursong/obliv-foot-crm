/**
 * E2E spec — T-20260727-foot-RESVMGMT-CARD-STATUS-BADGE-SYNC (P2, foot)
 *
 * 요구: 풋 예약관리 통합시간표 캘린더 타임슬롯 환자 카드(좌측 캘린더 그리드)에
 *   도파민TM 내원콜 결과('내원예정'/'부재') 배지를 표시. 대시보드 통합시간표 box카드(우측목록)는 이미 표시 O.
 *   → 예약관리(Reservations.tsx) 일간/주간 캘린더 카드에도 미러링.
 *
 * 현장 클릭 시나리오 3종(정적 소스 불변식으로 인코딩 — sibling T-20260725-VISITCALL 정적검증 스타일 계승):
 *   S1) 캘린더 카드에서 오늘 내원예정 예약 → '내원예정' 배지 노출 (일간·주간 공통).
 *   S2) 콜 부재(발동무음+부재) 예약 → '부재' 배지 노출 — 대시보드/우측목록과 동일 데이터소스(visit_call_result).
 *   S3) 콜 결과 없는(배지 없는) 카드는 레이아웃 깨짐 없음 (컴포넌트 self-null) + 배지 컴포넌트·스타일은 우측목록 기존 배지 재사용(색/모양 신규발명 0).
 *
 * 착수 가드(REDEFINITION_RISK) 회귀검증:
 *   - 자매 티켓 T-20260708-foot-RESVSTATUS-BESIDENAME-CARRYOVER(예약상태 표기 위치, blocked)와
 *     '같은 예약카드 상태-렌더 영역'을 공유 → 본 배지는 '카드 이름 옆(name-row)'에만 추가하고
 *     예약상태(STATUS_LABEL) 렌더 라인은 stomp 하지 않음(배지 삽입 위치 < 상태 라인 위치).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const RESV = 'src/pages/Reservations.tsx';
const DASH = 'src/pages/Dashboard.tsx';
const BADGE = 'src/components/VisitCallResultBadge.tsx';
const TYPES = 'src/lib/types.ts';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

test.describe('아티팩트 존재', () => {
  test('배지 컴포넌트 + 예약관리 페이지 존재', () => {
    expect(fs.existsSync(path.resolve(BADGE))).toBe(true);
    expect(fs.existsSync(path.resolve(RESV))).toBe(true);
  });
});

test.describe('AC4 — 배지 컴포넌트·데이터소스 재사용 (신규 발명 금지)', () => {
  test('예약관리가 기존 VisitCallResultBadge 컴포넌트를 import(신규 배지 컴포넌트 생성 0)', () => {
    const code = stripComments(read(RESV));
    expect(code).toMatch(
      /import\s*\{\s*VisitCallResultBadge\s*\}\s*from\s*'@\/components\/VisitCallResultBadge'/,
    );
  });

  test('데이터소스 = reservation.visit_call_result — 대시보드 우측목록과 동일 (신규 소스·파생 0)', () => {
    const resv = stripComments(read(RESV));
    const dash = stripComments(read(DASH));
    // 대시보드 box카드(우측목록) 관례
    expect(dash).toMatch(/<VisitCallResultBadge\s+result=\{reservation\.visit_call_result\}\s+compact\s*\/>/);
    // 예약관리 카드도 동일 필드(r.visit_call_result)를 그대로 소비
    expect(resv).toMatch(/<VisitCallResultBadge\s+result=\{r\.visit_call_result\}\s+compact\s*\/>/);
  });

  test('배지 컴포넌트 자체는 무변경 — 색/모양 SSOT 유지(emerald/rose·라벨 매핑)', () => {
    const b = read(BADGE);
    expect(b).toMatch(/VISIT_CALL_RESULT_LABEL/);
    expect(b).toMatch(/if\s*\(!result\)\s*return null/); // S3: 값 없으면 미렌더(레이아웃 무영향)
    expect(b).toMatch(/bg-emerald-100 text-emerald-700/); // reachable(내원예정)
    expect(b).toMatch(/bg-rose-100 text-rose-700/); // absent(부재)
    expect(b).toMatch(/data-testid="visit-call-result-badge"/);
  });

  test('라벨 SSOT: reachable→내원예정 / absent→부재', () => {
    const t = read(TYPES);
    expect(t).toMatch(/VISIT_CALL_RESULT_LABEL[\s\S]*?reachable:\s*'내원예정'/);
    expect(t).toMatch(/VISIT_CALL_RESULT_LABEL[\s\S]*?absent:\s*'부재'/);
  });
});

test.describe('S1/S2 — 일간·주간 캘린더 카드 양쪽에 배지 미러링', () => {
  const usages = () => {
    const code = stripComments(read(RESV));
    return code.match(/<VisitCallResultBadge\s+result=\{r\.visit_call_result\}\s+compact\s*\/>/g) ?? [];
  };

  test('예약관리 캘린더 카드에 배지 렌더가 정확히 2곳(일간 renderDayCard + 주간 renderCard)', () => {
    expect(usages().length).toBe(2);
  });

  test('두 배지 모두 취소건 게이트(r.status !== cancelled)로 스테일 콜결과 노출 방지', () => {
    const code = stripComments(read(RESV));
    // 게이트 + 배지가 인접한 블록이 2곳
    const gated = code.match(
      /r\.status\s*!==\s*'cancelled'\s*&&\s*\(\s*<VisitCallResultBadge\s+result=\{r\.visit_call_result\}\s+compact\s*\/>\s*\)/g,
    ) ?? [];
    expect(gated.length).toBe(2);
  });
});

test.describe('REDEFINITION_RISK — 자매 티켓 상태-렌더 영역 non-stomp', () => {
  test('배지는 이름 옆(name-row)에 위치 — 각 카드에서 상태라인(STATUS_LABEL[r.status])보다 앞', () => {
    const code = stripComments(read(RESV));
    // 각 배지 사용처가 그 뒤에 이어지는 STATUS_LABEL[r.status] 렌더보다 앞에 있어야 함(이름 옆 = 상태줄 위).
    const badgeRe = /<VisitCallResultBadge\s+result=\{r\.visit_call_result\}\s+compact\s*\/>/g;
    const statusRe = /STATUS_LABEL\[r\.status\]/g;
    const badgeIdx = [...code.matchAll(badgeRe)].map((m) => m.index ?? -1).filter((i) => i >= 0);
    const statusIdx = [...code.matchAll(statusRe)].map((m) => m.index ?? -1).filter((i) => i >= 0);
    expect(badgeIdx.length).toBe(2);
    expect(statusIdx.length).toBeGreaterThanOrEqual(2);
    // 첫 배지(일간) < 그 카드 상태라인, 둘째 배지(주간) < 그 카드 상태라인.
    // 배지 삽입이 상태-렌더 라인을 밀어내거나 대체하지 않음을 순서로 확인.
    expect(badgeIdx[0]).toBeLessThan(statusIdx.find((i) => i > badgeIdx[0])!);
    expect(badgeIdx[1]).toBeLessThan(statusIdx.find((i) => i > badgeIdx[1])!);
  });

  test('상태 렌더 라인 자체는 보존(STATUS_LABEL[r.status] 사용 유지)', () => {
    const code = stripComments(read(RESV));
    expect(code).toMatch(/STATUS_LABEL\[r\.status\]/);
  });
});
