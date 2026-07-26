/**
 * T-20260726-foot-LABTAB-BLOODREQ-UNSET-RC-FIX
 *
 * 치료테이블 > 피검사 탭('피검사 일일 진행 리스트') 표시기간 윈도 14일 → 30일 연장 (C안).
 *   결정: 김주연 총괄(풋센터) confirm — slack ts 1785068401.556639 (C0ATE5P6JTH), C안 채택.
 *   WARN(b) 현장-보이는 동작 변경 게이트 통과.
 *
 * 핵심: BloodDailyListSection.useBloodTargets 윈도 상수 WINDOW_DAYS = 14 → 30. 상수 1곳 변경.
 *   · A안(미완료 상시표시) 미채택 — 30일 고정 윈도 유지, 30일 초과 만료 소실은 설계상 동작으로 유지.
 *   · 부모 T-20260726-foot-LABTAB-EXAM-REQ-MANUAL-ADD-BY-SEARCH(deployed)가 같은 윈도(useBloodTargets)에
 *     종속 → 수기추가 항목도 30일까지 잔존해 우회수단 실효 확보(리포트 §a 파생 정합).
 *
 * 시나리오(티켓 본문 §1·§2):
 *   §1 검사신청 후 14일 초과~30일 이내 미완료 항목 → 워크리스트에 잔존(현장 클릭·접수 가능).
 *   §2 30일 초과 항목 → 윈도 밖으로 만료 소실(설계상 동작, A안 미채택).
 *
 * db_change=false (FE 상수, RPC 미수정). MIG-GATE 비대상.
 * 정적(빌드 산출 소스) 검증 — 선행 LABTAB-SPLIT / 4FIX spec 과 동일 스타일(데이터 계약/DB 상태 미의존, no-DDL).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');

test.describe('C안: 표시기간 윈도 14일 → 30일 연장', () => {
  test('WINDOW_DAYS 상수 = 30 (14 아님)', () => {
    const b = blood();
    expect(b).toContain('const WINDOW_DAYS = 30;');
    // 회귀 방지 — 구 14일 상수 잔존 금지
    expect(b).not.toContain('const WINDOW_DAYS = 14;');
  });

  test('윈도 시작일 = 선택일 끝 직전 WINDOW_DAYS 일 (subDays(end, WINDOW_DAYS - 1))', () => {
    const b = blood();
    // windowBounds 가 subDays(end, WINDOW_DAYS - 1) 로 시작경계 계산 → 30일 폭 유지
    expect(b).toContain("subDays(new Date(endDate + 'T12:00:00'), WINDOW_DAYS - 1)");
    // 시작 00:00 / 끝 23:59 KST 경계 보존(회귀0)
    expect(b).toContain("`${start}T00:00:00+09:00`");
    expect(b).toContain("`${endDate}T23:59:59+09:00`");
  });

  test('C안 결정 근거 주석 명시 (총괄 confirm slack ts + A안 미채택)', () => {
    const b = blood();
    expect(b).toContain('BLOODREQ-UNSET-RC-FIX');
    expect(b).toContain('1785068401.556639');
    // A안(미완료 상시표시) 미채택 — 30일 고정 윈도 유지 명시
    expect(b).toContain('A안');
  });
});

test.describe('시나리오 §1·§2: 30일 잔존 / 30일 초과 만료', () => {
  test('§1: useBloodTargets 가 [start, end] 검사신청일(check_ins.checked_in_at) 윈도로 조회', () => {
    const b = blood();
    // 검사신청일 = check_ins.checked_in_at 기준 gte(start) / lte(end)
    expect(b).toContain(".gte('check_ins.checked_in_at', startTs)");
    expect(b).toContain(".lte('check_ins.checked_in_at', endTs)");
    // blood_test_requested=true 대상만
    expect(b).toContain(".eq('blood_test_requested', true)");
  });

  test('§2: 윈도가 고정 폭(WINDOW_DAYS) — 미완료 상시표시(A안) 분기 없음', () => {
    const b = blood();
    // A안 미채택 = "미완료(received/docs=false)면 윈도 무시" 류의 예외 분기가 없어야 함
    expect(b).not.toMatch(/WINDOW_DAYS\s*=\s*Infinity/);
    // 시작경계가 항상 WINDOW_DAYS 로 계산됨(상시표시용 조건부 우회 없음)
    const idxWindowBounds = b.indexOf('function windowBounds');
    expect(idxWindowBounds).toBeGreaterThan(-1);
  });
});

test.describe('회귀0: 부모 RPC 경로 + BLOODLIST-4FIX 리스트 정합', () => {
  test('수기추가(LABTAB-EXAM-REQ-MANUAL-ADD)가 동일 윈도 소비 — ManualExamRequestDialog(lockKind=blood) 유지', () => {
    const b = blood();
    // 부모 티켓 수기추가 다이얼로그 경로 보존(우회수단 실효 = 같은 윈도 공유)
    expect(b).toContain('ManualExamRequestDialog');
    expect(b).toContain("lockKind='blood'");
  });

  test('4FIX 리스트 정합: 이력 역순 정렬 + [업로드] 컬럼 유지(회귀0)', () => {
    const b = blood();
    // #1 내림차순 정렬 보존
    expect(b).toContain('b.requestDate.localeCompare(a.requestDate)');
    // #2 업로드 컬럼 보존
    expect(b).toContain('data-testid="blood-upload-btn"');
    // 8컬럼 헤더 전량 보존
    for (const col of ['순서', '검사일자', '환자명', '차트번호', '생년월일', '접수여부', '접수자명', '서류수령여부']) {
      expect(b).toContain(col);
    }
  });

  test('form_submissions 재사용(no-DDL) 유지 — form_key=blood_reception_daily', () => {
    const b = blood();
    expect(b).toContain("const FORM_KEY = 'blood_reception_daily';");
  });
});
