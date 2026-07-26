/**
 * T-20260726-foot-RECEIVER-COORD-ACCT-DROPDOWN-WIDTH
 *
 * 치료테이블 > 피검사 탭('피검사 일일 진행 리스트') 접수자명·컬럼 개선. BLOODLIST-4FIX 위 증분(no-DDL).
 *
 * #1 접수자명 필드 → 드롭다운(계정 선택). 목록 = staff(role='coordinator', active=true) × 현재 클리닉(=종로풋센터).
 *    read-only, 신규 스키마 0. 저장값 = 現 field_data.receiver_name(이름 문자열) 그대로 → 선택값 저장·재조회 정상.
 * #2 4컬럼 너비 균일 — 접수여부/접수자명/서류수령여부/업로드 폭 통일(w-32).
 *
 * derm ASSIGNEE-DROPDOWN 계열(role 필터 + name 정렬) 하드포크 이식.
 * 정적(빌드 산출 소스) 검증 — 선행 BLOODLIST-4FIX spec 과 동일 스타일(데이터 계약/DB 상태 미의존, no-DDL).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');

test.describe('#1: 접수자명 = 코디네이터 계정 드롭다운', () => {
  test('useCoordinators 훅 — staff role=coordinator, active=true, 클리닉 스코프, 이름 정렬', () => {
    const b = blood();
    expect(b).toContain('function useCoordinators');
    expect(b).toContain("from('staff')");
    expect(b).toContain("eq('role', 'coordinator')"); // 코디네이터
    expect(b).toContain("eq('active', true)"); // 재직중
    expect(b).toContain("eq('clinic_id', clinicId)"); // branch = 종로풋센터(현재 클리닉)
    expect(b).toContain("order('name', { ascending: true })"); // 이름 정렬(derm ASSIGNEE 선례)
  });

  test('접수자명 셀이 텍스트 입력 → select 드롭다운으로 전환', () => {
    const b = blood();
    // 신규 드롭다운
    expect(b).toContain('data-testid="blood-receiver-select"');
    expect(b).toContain('<select');
    expect(b).toContain('접수자 선택'); // placeholder 옵션
    // 구 자유입력(input)은 접수자명 셀에서 제거 — 회귀 방지
    expect(b).not.toContain('data-testid="blood-receiver-input"');
  });

  test('드롭다운 옵션 = 코디네이터 목록(options prop 전달)', () => {
    const b = blood();
    expect(b).toContain('const { data: coordinators = [] } = useCoordinators(clinic?.id)');
    expect(b).toContain('options={coordinators}');
    expect(b).toContain('options: Coordinator[]');
    expect(b).toContain('options.map((o)');
  });

  test('선택값 저장·재조회 — receiver_name(이름 문자열) 경로 보존(스키마 무변경)', () => {
    const b = blood();
    // onCommit → 現 receiver_name 저장 경로 재사용(신규 컬럼 0)
    expect(b).toContain('patch: { receiverName: v }');
    expect(b).toContain('receiver_name: merged.receiverName');
    // select value = 저장값(재조회 시 선택 유지)
    expect(b).toContain('value={trimmed}');
  });

  test('목록 밖 저장값(레거시/퇴사) 보존 옵션 — 미선택 덮임 방지', () => {
    const b = blood();
    expect(b).toContain('const inList');
    expect(b).toContain('(목록 외)');
  });

  test('방어 폴백 — staff 미적용/스키마 불일치 prod 시 빈 목록(섹션 무파손)', () => {
    const b = blood();
    expect(b).toMatch(/staff\|relation\|42P01\|42703/);
  });
});

test.describe('#2: 4컬럼 너비 균일 (접수여부/접수자명/서류수령여부/업로드)', () => {
  test('4개 헤더 모두 동일 폭 클래스(w-32) 적용', () => {
    const b = blood();
    for (const col of ['접수여부', '접수자명', '서류수령여부', '업로드']) {
      const idx = b.indexOf(`>${col}<`);
      expect(idx, `${col} 헤더 존재`).toBeGreaterThan(-1);
      // 각 헤더 <th ...> 여는 태그에 w-32 포함
      const thStart = b.lastIndexOf('<th', idx);
      const thTag = b.slice(thStart, idx);
      expect(thTag, `${col} 헤더 w-32`).toContain('w-32');
    }
  });

  test('w-32 는 정확히 4개 컬럼에만 적용(균일 폭 4컬럼)', () => {
    const b = blood();
    const matches = b.match(/w-32/g) ?? [];
    expect(matches.length).toBe(4);
  });
});

test.describe('회귀: BLOODLIST-4FIX·선행 계약 보존', () => {
  test('form_key/영속/색상/정렬/업로드 계약 유지', () => {
    const b = blood();
    expect(b).toContain("FORM_KEY = 'blood_reception_daily'");
    expect(b).toContain('피검사 일일 진행 리스트');
    expect(b).toContain('data-testid="blood-daily-table"');
    expect(b).toContain('data-testid="blood-upload-btn"');
    // #1 역순 정렬 보존
    expect(b).toContain('b.requestDate.localeCompare(a.requestDate)');
    // 완료 자동비활성 보존
    expect(b).toContain('getState(r).docsReceived && uploadCountFor(r) >= 1');
    // 완료 시 접수자명 드롭다운도 잠금 유지
    expect(b).toContain('disabled={complete}');
    // 활성 행 색상 보존
    expect(b).toContain('bg-pink-50');
    expect(b).toContain('bg-yellow-50');
  });
});
