/**
 * E2E spec — T-20260617-foot-DOCDASH-DOCLIST-5FIX (P1)
 * 진료대시보드 + 진료 환자 목록 서브탭 다중 개선 (문지은 대표원장, #foot).
 *
 * 본 spec 커버 범위 = 이번 PR에 구현 완료된 4개 AC + A3 DEDUP 검증.
 *   A1  진료대시보드 테이블 가로 스크롤 실효화 (DoctorCallDashboard, 두 테이블 min-w + overflow-x-auto)
 *   A3  임상경과 입력창 처방칼럼 폭 초과 = ELAPSED-CLINICAL-3FIX(a1a44b10, main 머지) DEDUP 해소 검증
 *   B1(A4) 서브탭/헤더 라벨 '처방 환자 목록' → '진료 환자 목록' (DoctorTools + DoctorPatientList 헤더)
 *   B2(b) 진료완료목록 뷰어 경량 re-skin (MSG-20260618-002622-dfwd):
 *         B2-3 방·상태 칼럼 제거 / B2-4 '당일시술' 칼럼(treatmentSummary) / B2-5 진료완료행 처방·임상경과 read-only preview / B2-2 dateNav 재사용.
 *         ⚠ B2-3 으로 상태 칼럼 자체가 사라져 A2(진료완료행 상태 우정렬, StatusCell)는 본 뷰어에서 superseded → A2 describe = 상태칼럼/StatusCell 소거 검증으로 전환.
 *
 *   B2 풀미러(table 전환 + 생년월일 + 임상경과 인라인 칼럼)는 scope-외 → field-soak reporter confirm 시 별도 티켓.
 *
 * 컴포넌트가 auth/DB 의존 → 렌더 정본을 직접 읽어 정적 검증(repo 컨벤션, FONT-UNIFY/NAMECOL spec 동일 패턴).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const DASH = readFileSync(resolve(__dirname_, '../../src/components/doctor/DoctorCallDashboard.tsx'), 'utf-8');
const LIST = readFileSync(resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx'), 'utf-8');
const TOOLS = readFileSync(resolve(__dirname_, '../../src/pages/DoctorTools.tsx'), 'utf-8');

test.describe('A1 — 진료대시보드 테이블 가로 스크롤 실효화', () => {
  test('대기/완료 두 테이블 모두 min-w-[1040px] (table-fixed w-full 의 overflow 발동 조건)', () => {
    expect(DASH).toContain('w-full min-w-[1040px] table-fixed text-[15px]" data-testid="doctor-call-feed-table"');
    expect(DASH).toContain('w-full min-w-[1040px] table-fixed text-[15px]" data-testid="doctor-completed-table"');
  });

  test('overflow-x-auto 래퍼 유지 — 가로 스크롤 컨테이너 보존(회귀 0)', () => {
    expect([...DASH.matchAll(/<div className="overflow-x-auto">/g)].length).toBeGreaterThanOrEqual(2);
  });

  test('colgroup 8칼럼 % 합 100 무회귀(두 테이블 동일 폭셋)', () => {
    // 4 + 8 + 7 + 9 + 8 + 9 + 18 + 37 = 100
    const widths = [...DASH.matchAll(/<col className="w-\[(\d+)%\]" \/>/g)].map((m) => Number(m[1]));
    // 두 colgroup(대기/완료) → 16개 col, 각 8개 합 100
    expect(widths.length).toBe(16);
    const firstSum = widths.slice(0, 8).reduce((a, b) => a + b, 0);
    const secondSum = widths.slice(8, 16).reduce((a, b) => a + b, 0);
    expect(firstSum).toBe(100);
    expect(secondSum).toBe(100);
  });
});

test.describe('B2-3 — 진료완료목록 뷰어에서 방·상태 칼럼 제거 (A2 superseded)', () => {
  test('상태 칼럼(StatusCell) 컴포넌트 소거 — 정의/렌더/status-cell testid 0건', () => {
    expect(LIST).not.toContain('function StatusCell');
    expect(LIST).not.toContain('<StatusCell ');
    expect(LIST).not.toContain('data-testid="status-cell"');
  });

  test('방 칼럼(치료실) 소거 — getAssignedSlotName import·patient-room testid 0건', () => {
    // import 구문에서 getAssignedSlotName 제거(주석 언급은 무관)
    expect(LIST).not.toMatch(/import\s*\{[^}]*getAssignedSlotName[^}]*\}\s*from/);
    expect(LIST).not.toContain('data-testid="patient-room"');
    // MapPin 아이콘도 import 제거(방 셀 전용)
    expect(LIST).not.toMatch(/import\s*\{[^}]*\bMapPin\b[^}]*\}\s*from 'lucide-react'/);
  });

  test('오늘모드 grid = 방문유형·이름·차트번호·당일시술·처방·예약메모·액션 7칼럼(방/상태 폭 제거)', () => {
    expect(LIST).toContain('grid grid-cols-[3rem_5rem_4.5rem_7rem_5.5rem_minmax(0,1fr)_auto]');
    // 구 8칼럼(방 4.75rem + 상태 3.75rem 포함) 잔재 0
    expect(LIST).not.toContain('grid-cols-[4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto]');
  });

  test('완료 판정 SSOT(completed_at || pink) 분류/CRUD 로직 불변', () => {
    expect(LIST).toContain("const isVisitDone = !!row.completed_at || row.status_flag === 'pink';");
  });
});

test.describe('B2-4 — 당일시술 칼럼(treatmentSummary)', () => {
  test('당일시술 셀 + 라벨 노출(thead 없는 카드그리드 → 셀 내 미니라벨)', () => {
    expect(LIST).toContain('data-testid="treatment-today"');
    expect(LIST).toContain('<span className="text-[10px] text-gray-400">당일시술</span>');
  });

  test('값 = treatmentSummary SSOT(read-only 파생) 사용', () => {
    expect(LIST).toContain('const t = treatmentSummary(row);');
  });
});

test.describe('B2-5 — 진료완료행 처방·임상경과 read-only preview', () => {
  test('진료완료(isVisitDone) 행은 처방 편집폼(QuickRxBar)·확정/취소(RxConfirmedSummary) 미노출', () => {
    expect(LIST).toContain('{expanded && !isConfirmed && !isVisitDone && (');
    expect(LIST).toContain('{expanded && isConfirmed && !isVisitDone && (');
  });

  test('진료완료행 처방 read-only preview 블록 + 내용없음 폴백', () => {
    expect(LIST).toContain('{expanded && isVisitDone && (');
    expect(LIST).toContain('data-testid="done-rx-readonly"');
    expect(LIST).toContain("{hasRx ? rxLine : '내용 없음'}");
  });

  test('임상경과 read-only 게이트(DONE-CLINICAL-READONLY) 재사용 — readOnly={!isToday || isVisitDone}', () => {
    expect(LIST).toContain('readOnly={!isToday || isVisitDone}');
  });

  test('처방내역 read 라인은 진료완료행에서 중복 미노출(isVisitDone 제외)', () => {
    expect(LIST).toContain('{!isConfirmed && !isVisitDone && (');
  });
});

test.describe('B2-2 — dateNav 기존 재사용(신규 구현 금지)', () => {
  test('selectedDate + isPast read-only 분기 보존', () => {
    expect(LIST).toContain("const isToday = selectedDate === todayISO;");
    expect(LIST).toContain('const isPast = selectedDate < todayISO;');
  });
});

test.describe('A3 (DEDUP) — 임상경과 입력창 처방칼럼 폭 초과 해소(ELAPSED-CLINICAL-3FIX)', () => {
  test('대기/완료 인라인 임상경과 패널 모두 ml-auto w-1/2 overflow-hidden(50% 우측 clamp)', () => {
    expect(DASH).toContain('ml-auto w-1/2 overflow-hidden" data-testid="doctor-call-chart-inline-half"');
    expect(DASH).toContain('ml-auto w-1/2 overflow-hidden" data-testid="doctor-completed-chart-inline-half"');
  });

  test('colSpan 은 폭 정렬 위해 유지(패널은 우측 절반만 차지 → 처방칸 비침범)', () => {
    expect(DASH).toContain('colSpan={DOCDASH_COLSPAN}');
    expect(DASH).toContain('colSpan={DOCDASH_COMPLETED_COLSPAN}');
  });
});

test.describe('B1(A4) — 서브탭/헤더 라벨 → 진료 환자 목록', () => {
  test('DoctorTools 서브탭 텍스트 = "진료 환자 목록"', () => {
    expect(TOOLS).toMatch(/<Users className="h-3\.5 w-3\.5" \/>\s*진료 환자 목록/);
  });

  test('서브탭 라벨에 구 "처방 환자 목록" 잔재 0건(탭 텍스트)', () => {
    expect(TOOLS).not.toMatch(/<Users className="h-3\.5 w-3\.5" \/>\s*처방 환자 목록/);
  });

  test('value="patient_list" / data-testid="tab-patient-list" 보존(E2E·탭 상태키 불변)', () => {
    expect(TOOLS).toContain('value="patient_list" className="gap-1.5" data-testid="tab-patient-list"');
  });

  test('페이지 설명 문구도 "진료 환자 목록"으로 일관', () => {
    expect(TOOLS).toContain('진료 알림판 · 진료 환자 목록 · 균검사지(KOH) · 소견서를 확인합니다.');
  });

  test('DoctorPatientList 헤더 라벨 = "진료 환자 목록"', () => {
    expect(LIST).toContain('<p className="text-sm font-medium">진료 환자 목록</p>');
  });
});

test.describe('회귀 — 행필터·내부 필터탭 라벨·진료콜 모집단 불변', () => {
  test('내부 처방상태 필터탭 라벨("처방환자 목록")은 별개 컨트롤 → 불변', () => {
    // L1013: 처방전 있는 환자 필터 카운트 라벨(서브탭 라벨과 다른 축)
    expect(LIST).toContain('처방환자 목록 (${confirmedCount})');
  });

  test('진료콜 명단 교집합 모집단 필터 로직 불변(RXLIST-RENAME-DOCTORCALL-FILTER)', () => {
    expect(LIST).toContain('진료콜 명단에 오른 환자가 없습니다.');
  });
});
