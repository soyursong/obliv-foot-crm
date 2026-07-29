/**
 * T-20260728-foot-RECEIVER-COORD-DROPDOWN-EMPTY-FIX
 *
 * 치료테이블 > 피검사 탭('피검사 일일 진행 리스트', BloodDailyListSection) 접수자명 드롭다운이
 * 코디네이터 0명(빈목록)으로 렌더되던 버그 수정. prior RECEIVER-COORD-ACCT-DROPDOWN-WIDTH(7c38d4ad)의
 * field-soak WARN 확증분.
 *
 * RC(진단 확정): 데이터는 정상(종로풋센터 staff role='coordinator'(canonical 영문) active=5명). 원인은 코드 —
 *   useCoordinators 훅 select 에 derm 하드포크 잔재로 `display_name` 포함 → foot `staff`엔 해당 컬럼 부재
 *   → PostgREST 42703(column does not exist) → 훅의 과대 폴백 정규식(/column|42703/)이 에러를 삼켜 [] 반환 = 빈 드롭다운.
 *   (foot staff 실컬럼: id, clinic_id, name, role, active, user_id, ...  — display_name 없음)
 *
 * FIX(단일 레이어 A, no-DDL, staff read-only):
 *   ① select 에서 display_name 제거 → name 단일 소스.
 *   ② 폴백을 undefined_table(42P01)로 축소 → 컬럼/스키마 오류는 throw(silent-empty 재발·field-soak 은닉 방지).
 *
 * 정적(빌드 산출 소스) 검증 — 선행 spec 과 동일 스타일(데이터 계약/DB 상태 미의존, no-DDL).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');

// 훅 본문만 추출 + 주석 제거(설명 주석의 display_name/42703 문자열이 부정단언에 오탐되지 않도록 코드만 검사)
function coordHook(src: string): string {
  const start = src.indexOf('function useCoordinators');
  expect(start).toBeGreaterThanOrEqual(0);
  // usePersistReception(다음 함수) 직전까지
  const end = src.indexOf('function usePersistReception', start);
  const body = end > start ? src.slice(start, end) : src.slice(start);
  // `//` 라인 주석 제거(코드 라인만 남김)
  return body
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

test.describe('RC 가드: useCoordinators select 는 실재 컬럼만 조회(display_name 금지)', () => {
  test('select 에 존재하지 않는 display_name 컬럼이 없다(빈목록 RC 봉인)', () => {
    const h = coordHook(blood());
    expect(h).toContain("from('staff')");
    // ★ RC: foot staff 에 display_name 부재 → 조회 금지
    expect(h).not.toContain('display_name');
    // 실재 컬럼(name)만으로 조회
    expect(h).toContain("select('id, name, role, active')");
  });

  test('필터 값은 canonical 영문 그대로(데이터 정상 확증분) — role=coordinator, active=true, 클리닉 스코프, 이름정렬', () => {
    const h = coordHook(blood());
    expect(h).toContain("eq('role', 'coordinator')");
    expect(h).toContain("eq('active', true)");
    expect(h).toContain("eq('clinic_id', clinicId)");
    expect(h).toContain("order('name', { ascending: true })");
  });

  test('name 매핑 — display_name 참조 제거, name 단일 소스', () => {
    const h = coordHook(blood());
    expect(h).toContain('(r.name || ');
    expect(h).not.toContain('r.display_name');
  });
});

test.describe('폴백 축소: 컬럼/스키마 오류는 삼키지 않고 throw(silent-empty 재발 방지)', () => {
  test('폴백은 undefined_table(42P01)에만 [] 반환 — 42703/column 광역 매치 제거', () => {
    const h = coordHook(blood());
    // 좁혀진 폴백
    expect(h).toContain("error.code === '42P01'");
    // 과대 폴백(컬럼 오류까지 삼키던 정규식) 제거 확인
    expect(h).not.toContain('42703');
    expect(h).not.toMatch(/staff\|relation\|42P01\|42703\|column/);
  });
});

test.describe('회귀: 드롭다운 렌더·선택·저장 경로 보존', () => {
  test('접수자명 셀 = select 드롭다운(목록 밖 값 보존 옵션 유지)', () => {
    const b = blood();
    expect(b).toContain('data-testid="blood-receiver-select"');
    expect(b).toContain('접수자 선택'); // placeholder
    expect(b).toContain('(목록 외)'); // 레거시/퇴사 저장값 방어 옵션 보존
    expect(b).toContain('options.map((o)');
  });

  test('선택값 저장·재조회 — field_data.receiver_name 경로 그대로(no-DDL)', () => {
    const b = blood();
    expect(b).toContain('receiver_name: merged.receiverName');
    expect(b).toContain('value={trimmed}');
    expect(b).toContain('options={coordinators}');
  });
});
