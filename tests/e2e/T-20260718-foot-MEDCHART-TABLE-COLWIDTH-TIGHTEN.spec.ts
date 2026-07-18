/**
 * E2E spec — T-20260718-foot-MEDCHART-TABLE-COLWIDTH-TIGHTEN
 * 진료 화면 표 컬럼 폭을 예상 텍스트 범위 기준으로 계산·지정 → 좌우 불필요 여백 제거.
 * 요청: 문지은 대표원장(C0ATE5P6JTH, 2026-07-18) "표 항목마다 예상 텍스트를 계산해서 너무 불필요한 여백 두지 마".
 *
 * 검증 방식: 정적 소스 불변식(static source invariants). 표시 CSS 한정 변경이라
 *   auth/DB 마운트 대신 구현 소스의 폭 계산·안전처리·회귀 마커를 직접 단언한다.
 *   (선행 T-20260613-foot-CLINIC3-TABLEDENSITY-TIGHTEN.spec.ts 와 동일 컨벤션)
 *
 * 시나리오(티켓 현장 클릭):
 *   S1 진료대시보드(DoctorCallDashboard) — %→고정px 컬럼 폭(예상 텍스트 밀착) + 임상경과 auto 흡수 +
 *      ellipsis+tooltip 안전처리 + 회귀(손들기 토글·처방/임상경과 미리보기·WAITDONE-ALIGN 동일 colgroup).
 *   S2 진료환자목록(DoctorPatientList) — 밀도 기준 화면. 고정 rem 컬럼(예상 텍스트 기준) + 미리보기·필터 회귀.
 *   S3 균검사지(KohReportTab) — table w-full 제거(fit-content shrink-to-content) + PHASE15 무접촉.
 *   S4 공통 — AC-4 선행 패딩 압축(px-1.5 py-1) 재변경 금지(보존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd(); // playwright 는 프로젝트 루트에서 실행
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const DOCDASH = 'src/components/doctor/DoctorCallDashboard.tsx';
const PATIENTLIST = 'src/components/doctor/DoctorPatientList.tsx';
const KOH = 'src/components/doctor/KohReportTab.tsx';

// ── S1: 진료대시보드 — 예상 텍스트 기준 고정px 컬럼 폭 ────────────────────────────
test.describe('S1 진료대시보드 컬럼 폭 타이트닝', () => {
  const src = read(DOCDASH);

  test('AC-1 메타데이터 컬럼 폭 = %가 아닌 고정px(예상 텍스트 밀착)', () => {
    // 이전 % colgroup 잔재 0 — 팽창 여백의 원인.
    expect(src).not.toContain('<col className="w-[4%]" />');
    expect(src).not.toContain('<col className="w-[8%]" />');
    expect(src).not.toContain('<col className="w-[18%]" />');
    expect(src).not.toContain('<col className="w-[37%]" />');
    // 예상 텍스트 범위로 계산·지정된 고정 px 폭 시퀀스(방·상태·이름·생년·차트번호·오늘시술·처방).
    const FIXED_COLGROUP = [
      '<col className="w-14" />',  // 방 (방번호 1~3자)
      '<col className="w-28" />',  // 상태 (진료필요✋+N분)
      '<col className="w-36" />',  // 이름 (초/재배지+이름+서류)
      '<col className="w-28" />',  // 생년(만나이) ("1990 (만 35세)")
      '<col className="w-16" />',  // 차트번호 (mono 7자)
      '<col className="w-24" />',  // 오늘시술 (truncate)
      '<col className="w-40" />',  // 처방
      '<col />',                    // 임상경과 (auto — 잔여폭 흡수)
    ].join('\n                ');
    expect(src).toContain(FIXED_COLGROUP);
  });

  test('AC-1 임상경과 본문 컬럼은 폭 미지정(auto)으로 잔여폭 흡수 — 양 테이블 동일 colgroup 2회', () => {
    // 진료대기 + 진료완료 두 테이블에 동일 고정 colgroup(WAITDONE-ALIGN 픽셀 경계 일치).
    const occurrences = src.split('<col className="w-14" />').length - 1;
    expect(occurrences).toBe(2);
    // 임상경과 auto col 도 2회(각 테이블 말미).
    expect(src.split(/<col \/>/).length - 1).toBe(2);
  });

  test('AC-2 넘침 안전처리 — 오늘시술 truncate + title tooltip(정보손실 0)', () => {
    // ProcedureCell 값 span: block truncate + title={v}
    expect(src).toContain('block truncate text-[13px] font-medium text-gray-700');
    expect(src).toMatch(/data-testid="doctor-procedure-cell" title=\{v\}/);
    // 임상경과 미리보기 truncate 안전처리 보존.
    expect(src).toContain('block w-full max-w-full truncate text-center');
  });

  test('AC-3 회귀 — 손들기 토글·처방/임상경과 미리보기 셀·양 테이블 마커 보존', () => {
    expect(src).toContain('HandToggle'); // 손들기 ✋ 토글
    expect(src).toContain('data-testid="doctor-call-rx-cell"'); // 처방 셀
    expect(src).toContain('data-testid="doctor-call-clinical-cell"'); // 임상경과 미리보기 셀
    expect(src).toContain('data-testid="doctor-call-feed-table"');
    expect(src).toContain('data-testid="doctor-completed-table"');
    // 8칼럼 헤더 순서 보존.
    expect(src).toContain('<th className="px-1.5 py-1">생년(만나이)</th>');
    expect(src).toContain('<th className="px-1.5 py-1">임상경과</th>');
    // min-w-[1040px] 유지(가로스크롤 무회귀).
    expect(src).toContain('min-w-[1040px]');
  });
});

// ── S2: 진료환자목록 — 밀도 기준(고정 rem 컬럼) ──────────────────────────────────
test.describe('S2 진료환자목록 밀도(기준)', () => {
  const src = read(PATIENTLIST);

  test('AC-1 고정 rem grid 컬럼(예상 텍스트 기준) 보존 — 밀도 기준 화면', () => {
    // 오늘 모드 + 이력 모드 고정 rem 템플릿(방문유형·이름·차트번호·시술·처방·1fr·auto).
    expect(src).toContain('grid-cols-[3rem_5rem_4.5rem_7rem_5.5rem_minmax(0,1fr)_auto]');
    expect(src).toContain('grid-cols-[3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto]');
  });

  test('AC-2 넘침 안전처리 — 이름/차트번호/시술 truncate + title 보존', () => {
    expect(src).toContain('min-w-0 max-w-full truncate text-left');
    expect(src).toContain('title={row.customer_name}');
    expect(src).toContain('title={chartNoDisplay(row.chart_number)}');
    expect(src).toContain('max-w-[8rem]'); // 치료종류 폭 상한
  });

  test('AC-3 회귀 — 이름 클릭 차트·처방배지·예약메모 미리보기 마커 보존', () => {
    expect(src).toContain('data-testid="patient-name"');
    expect(src).toContain('data-testid="patient-chartno"');
    expect(src).toContain('PrescriptionStatusBadge');
    expect(src).toContain('data-testid="booking-memo"');
  });
});

// ── S3: 균검사지 — fit-content shrink-to-content ────────────────────────────────
test.describe('S3 균검사지 컬럼 폭 타이트닝', () => {
  const src = read(KOH);

  test('AC-1 table w-full 제거 → auto shrink-to-content(래퍼 w-fit 밀착)', () => {
    // w-full stretch(컬럼 사이 여백 원인) 제거.
    expect(src).not.toContain('<table className="w-full text-sm">');
    expect(src).toContain('<table className="text-sm">');
    // 래퍼: 테두리가 표 내용에 밀착(w-fit) + 좁은 화면 가로스크롤 유지.
    expect(src).toContain('w-fit max-w-full overflow-x-auto rounded-lg border');
    expect(src).toContain('data-testid="koh-table"');
  });

  test('AC-2 컬럼 텍스트 밀착(whitespace-nowrap) + 이름 truncate+title 보존', () => {
    expect(src).toContain('whitespace-nowrap'); // 컬럼 텍스트 밀착
    expect(src).toContain('block max-w-full truncate text-left'); // 이름 셀 안전처리
    expect(src).toContain('max-w-[8rem]'); // 이름 폭 상한
  });

  test('AC-3 회귀 — PHASE15(진료의) 및 신청/발급 컬럼 무접촉', () => {
    expect(src).toContain('data-testid="koh-cell-doctor"'); // PHASE15 진료의
    expect(src).toContain('doctorNameForRow'); // PHASE15 로직
    expect(src).toContain('data-testid="koh-cell-status"'); // 신청유무
    expect(src).toContain('data-testid="koh-cell-publish"'); // 발급여부
    expect(src).toContain('data-testid="koh-cell-birth"');
  });
});

// ── S4: 공통 — AC-4 선행 패딩 압축(px-1.5 py-1) 재변경 금지 ──────────────────────
test.describe('S4 공통 — 선행 패딩 압축 보존(재변경 금지)', () => {
  test('AC-4 세 화면 모두 셀 패딩 px-1.5 py-1 유지', () => {
    for (const rel of [DOCDASH, PATIENTLIST, KOH]) {
      expect(read(rel)).toContain('px-1.5 py-1');
    }
  });
});
