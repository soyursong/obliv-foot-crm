/**
 * E2E spec — T-20260613-foot-CLINIC3-TABLEDENSITY-TIGHTEN
 * 3개 진료화면(진료대시보드·진료환자목록·균검사지) 테이블 밀도 압축.
 *
 * 검증 방식: 정적 소스 불변식(static source invariants). 표시 CSS 한정 변경이라
 *   auth/DB 마운트 대신 구현 소스의 밀도/정렬/회귀 마커를 직접 단언한다.
 *
 * 시나리오(티켓 본문):
 *   S1 화면1 진료대시보드 밀도 — 좌측정렬(이름 중앙→좌측 supersede)·셀 패딩 압축·회귀(손들기/차트/처방).
 *   S2 화면2 진료환자목록 밀도 + 정보 보존 — 좌측정렬·여백 압축·회귀(미리보기/필터/빠른처방)·MIRROR 톤 일관.
 *   S3 화면3 균검사지 테이블 밀도 — <table> 유지·패딩 압축·좌측 헤더·PHASE15 무접촉.
 *   S4 overflow 안전 — truncate/ellipsis + title tooltip.
 *
 * 공통 밀도 규칙(AC-1~4): 좌측정렬 / 컬럼폭 타이트 / 여백 4~6px / overflow ellipsis+tooltip.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd(); // playwright 는 프로젝트 루트에서 실행
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const DOCDASH = 'src/components/doctor/DoctorCallDashboard.tsx';
const PATIENTLIST = 'src/components/doctor/DoctorPatientList.tsx';
const KOH = 'src/components/doctor/KohReportTab.tsx';

// ── S1: 화면1 진료대시보드(DoctorCallDashboard) 밀도 + 좌측정렬 ────────────────
test.describe('S1 화면1 진료대시보드 밀도', () => {
  const src = read(DOCDASH);

  test('AC-1 좌측정렬 — 헤더 tr·셀 td 가 text-left (중앙정렬 supersede)', () => {
    // 헤더 행: 중앙 → 좌측
    expect(src).toContain('bg-gray-50/70 text-left text-[13px] font-semibold text-muted-foreground');
    expect(src).not.toContain('bg-gray-50/70 text-center');
    // 데이터 셀: 이전 'px-2 py-2 text-center' 잔재 0
    expect(src).not.toContain('px-2 py-2 text-center');
    // 이름 버튼: 중앙 → 좌측
    expect(src).toContain('min-w-[4rem] break-keep text-left');
    expect(src).not.toContain('min-w-[4rem] break-keep text-center');
  });

  test('AC-2/3 여백 최소화 — 셀 패딩 px-1.5 py-1, 셀 내부 flex 좌측(justify-start)', () => {
    expect(src).toContain('px-1.5 py-1 text-left'); // td
    expect(src).toContain('className="px-1.5 py-1"'); // th
    // 셀 내부 정렬: justify-center(gap 동반) 잔재 0 → justify-start
    expect(src).not.toMatch(/items-center justify-center gap-/);
    expect(src).toMatch(/items-center justify-start gap-/);
  });

  test('AC-5 회귀 — 손들기 토글·차트 컬럼·처방 셀 마커 보존', () => {
    expect(src).toContain('HandToggle'); // 손들기 ✋ 토글
    expect(src).toContain('doctor-call-chart-cell'); // 차트 컬럼
    expect(src).toContain('doctor-call-rx-cell'); // 처방 셀
    expect(src).toContain('data-testid="doctor-call-feed-table"');
    expect(src).toContain('data-testid="doctor-completed-table"');
  });
});

// ── S2: 화면2 진료환자목록(DoctorPatientList) 밀도 + 좌측정렬 + 정보 보존 ────────
test.describe('S2 화면2 진료환자목록 밀도(기준)', () => {
  const src = read(PATIENTLIST);

  test('AC-1 좌측정렬 — 이름/차트 셀 text-left, 배지 래퍼 justify-start', () => {
    expect(src).toContain('truncate text-left'); // 이름·차트번호 셀
    expect(src).not.toContain('truncate text-center');
    expect(src).toContain('className="flex justify-start"'); // 방문/처방 배지 래퍼
    // 배지 래퍼의 중앙정렬 잔재 0 (로딩 spinner 'flex justify-center py-12'는 예외 유지)
    expect(src).not.toContain('className="flex justify-center">');
  });

  test('AC-3 여백 압축 — grid gap-1.5 px-2 py-1.5', () => {
    expect(src).toContain('items-center gap-1.5 px-2 py-1.5');
    expect(src).not.toContain('items-center gap-2 px-3 py-2.5');
  });

  test('AC-5 회귀 — 미리보기/필터/빠른처방/배지 보존', () => {
    expect(src).toContain('data-testid="patient-name"');
    expect(src).toContain('data-testid="prescription-badge"');
    expect(src).toContain('data-testid="rx-tooltip"'); // 처방내용 미리보기 hover
    expect(src).toContain('data-testid="treatment-kind"');
    expect(src).toContain('data-testid="confirm-prescription-btn"'); // 빠른 확정
    expect(src).toContain('data-testid="booking-memo"');
  });

  test('MIRROR 흡수 — 모노톤 톤 일관(이름 옆 장식 이모지/시계/꺾쇠 없음), 기능 배지는 보존', () => {
    // 이름 셀(patient-name) 주변에 장식 이모지·시계 직접 텍스트 없음.
    // (Clock 아이콘은 '임시처방' 상태 배지 기능용으로 보존됨 — 이름 옆 장식 아님)
    const nameBlock = src.slice(src.indexOf('data-testid="patient-name"') - 200, src.indexOf('data-testid="patient-name"') + 80);
    expect(nameBlock).not.toMatch(/🕐|⏰|🕒/);
  });
});

// ── S3: 화면3 균검사지(KohReportTab) 테이블 밀도 + PHASE15 무접촉 ───────────────
test.describe('S3 화면3 균검사지 테이블 밀도', () => {
  const src = read(KOH);

  test('AC-6 테이블뷰 유지(<table>) + 헤더 좌측정렬', () => {
    expect(src).toContain('<table');
    expect(src).toContain('data-testid="koh-table"');
    expect(src).toContain('text-left text-xs text-muted-foreground'); // thead tr 좌측
  });

  test('AC-2/3 여백 압축 — th/td px-1.5 py-1, 컬럼 nowrap(타이트)', () => {
    expect(src).toContain('px-1.5 py-1');
    expect(src).not.toContain('px-3 py-2.5'); // 기존 과여백 제거
    expect(src).toContain('whitespace-nowrap'); // 컬럼 줄바꿈 방지(타이트)
  });

  test('AC-6 PHASE15 무접촉 — koh_nail_sites/RPC/조인/위젯 코드 보존', () => {
    expect(src).toContain('set_koh_nail_sites'); // PHASE15 RPC 그대로
    expect(src).toContain('koh_nail_sites'); // jsonb 컬럼 참조 그대로
    expect(src).toContain('data-testid="nail-site-editor"'); // 발톱부위 입력 위젯
    expect(src).toContain('signing_doctor_name'); // 당일의사 조인
    // 6컬럼 read-only 헤더 보존
    for (const col of ['환자이름', '생년월일', '차트번호', '검사일', '조갑부위', '당일 진료의사']) {
      expect(src).toContain(col);
    }
  });
});

// ── S4: overflow 안전 — ellipsis(truncate) + title tooltip ─────────────────────
test.describe('S4 overflow 안전', () => {
  test('3개 화면 — truncate + title 동반(잘린 내용 hover 확인)', () => {
    const docdash = read(DOCDASH);
    const list = read(PATIENTLIST);
    const koh = read(KOH);
    // 화면1 임상경과 셀: truncate + title
    expect(docdash).toMatch(/truncate[^>]*title=\{clinicalPreview\}|title=\{clinicalPreview\}/);
    // 화면2 이름/처방/치료: truncate + title 다수
    expect(list).toContain('truncate');
    expect(list).toContain('title={row.customer_name}');
    // 화면3 이름 셀: truncate + title
    expect(koh).toContain('truncate');
    expect(koh).toContain('title={`${r.customer_name}');
  });
});
