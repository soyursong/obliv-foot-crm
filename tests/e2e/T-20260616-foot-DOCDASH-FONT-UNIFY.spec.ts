/**
 * E2E spec — T-20260616-foot-DOCDASH-FONT-UNIFY (P2)
 * 진료대시보드(진료 알림판, DoctorCallDashboard) 환자목록 테이블 폰트 통일.
 * 요청(문지은 대표원장, #foot):
 *   AC-1 환자이름 칼럼만 '겁나 볼드체' → 다른 데이터 칼럼과 weight/family 통일(과한 볼드 제거).
 *   AC-2 차트번호 칼럼 폰트 '이상' → 테이블 표준 데이터 폰트로 통일(값·포맷 불변).
 *
 * 결정(진행 로그 근거):
 *   AC-1 이름 span: text-[15px] font-semibold(600) → text-[15px] font-medium(500).
 *     같은 15px 클릭 데이터셀인 처방 링크(text-[15px] font-medium)와 동일 weight로 통일.
 *     size(15px)·정렬(text-left)·배지·클릭동선은 NAMECOL 결과 그대로(weight만 조정).
 *   AC-2 차트번호 span: font-mono(monospace 글꼴이 다른 셀과 튀어 보임) 제거 → tabular-nums.
 *     표준 sans 글꼴로 통일하되 자릿폭 정렬 유지(같은 테이블 경과시간 셀과 동일 컨벤션).
 *     '튀지 않게 통일' 현장 의도 + 숫자 가독성 동시 충족. 값·포맷(chartNoDisplay) 불변.
 *
 * 순수 presentation(CSS). DB·EF·토큰매핑·정렬로직 무변경.
 * 컴포넌트가 auth/DB에 의존하므로 렌더 정본(DoctorCallDashboard.tsx)을 직접 읽어 정적 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorCallDashboard.tsx');
const src = readFileSync(SRC, 'utf-8');

test.describe('FONT-UNIFY AC-1 — 이름 칼럼 과한 볼드 해소(font-medium 통일)', () => {
  test('이름 span: font-semibold 제거 → text-[15px] font-medium, 두 행(활성/진료완료) 모두', () => {
    const medHits = [...src.matchAll(/block text-\[15px\] font-medium">\{checkIn\.customer_name\}/g)].length;
    expect(medHits).toBe(2);
    // 구 과한 볼드(font-semibold) 이름 span 잔재 0건
    expect(src).not.toContain('block text-[15px] font-semibold">{checkIn.customer_name}');
  });

  test('처방 링크(통일 기준 SSOT)도 동일 text-[15px] font-medium 유지', () => {
    expect(src).toContain('text-[15px] font-medium');
  });
});

test.describe('FONT-UNIFY AC-2 — 차트번호 폰트 통일(font-mono 제거 → tabular-nums)', () => {
  test('차트번호 span: font-mono className 0건(monospace 글꼴 제거)', () => {
    // className에 font-mono 사용 0 (주석 내 설명 문자열은 무관)
    expect(src).not.toMatch(/className="[^"]*font-mono[^"]*"/);
  });

  test('차트번호 span: tabular-nums text-[13px] text-gray-500, 두 행 모두', () => {
    expect(src).toContain('tabular-nums text-[13px] text-gray-500" data-testid="doctor-call-chartno"');
    expect(src).toContain('tabular-nums text-[13px] text-gray-500" data-testid="doctor-completed-chartno"');
  });
});

test.describe('회귀 — 값·포맷·정렬·배지·차트진입 불변', () => {
  test('차트번호 값·포맷(chartNoDisplay) 불변', () => {
    expect(src).toContain('{chartNoDisplay(readChartNo(checkIn))}');
  });

  test('NAMECOL 결과 보존 — 이름 좌정렬(text-left) + 배지 앵커(justify-start) 무회귀', () => {
    expect([...src.matchAll(/min-w-\[4rem\] break-keep text-left/g)].length).toBeGreaterThanOrEqual(2);
    expect([...src.matchAll(/flex items-center justify-start gap-1\.5/g)].length).toBeGreaterThanOrEqual(2);
  });

  test('이름 클릭 → 진료차트 진입 동선 + testid 보존', () => {
    expect(src).toContain('data-testid="doctor-call-name-chart-btn"');
    expect(src).toContain('data-testid="doctor-completed-name-chart-btn"');
    expect(src).toContain('data-testid="doctor-call-chartno"');
    expect(src).toContain('data-testid="doctor-completed-chartno"');
  });
});
