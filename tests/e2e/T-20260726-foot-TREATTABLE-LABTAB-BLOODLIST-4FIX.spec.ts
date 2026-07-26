/**
 * T-20260726-foot-TREATTABLE-LABTAB-BLOODLIST-4FIX
 *
 * 치료테이블 > 피검사 탭('피검사 일일 진행 리스트') 4개 개선. 선행 deployed 2건 위 증분:
 *   · T-20260724-LABTAB-SPLIT (BloodDailyListSection, form_submissions form_key='blood_reception_daily')
 *   · T-20260723-LABTEST (patient_file_records kind='blood_result', BloodResultDialog↔PatientResultFiles)
 *
 * #1 이력 역순 정렬 — 최신 접수(검사신청일) 맨 위, 오래된 것 아래(내림차순). grain=customer×request_date.
 * #2 [업로드] 컬럼 신규(9번째) — 행별 결과지 업로드 버튼. 기존 8컬럼/순서/색상 유지.
 * #3 업로드→2번차트 검사결과 자동반영 — T-20260723 patient_file_records(kind='blood_result') 경로 재사용(신규 경로 0).
 *    BloodResultDialog + query key 'blood_result_counts' 공유(ExamTargetsSection·CustomerChartPage 검사결과 탭과 동일 소스).
 * #4 완료 행 자동 비활성 — 서류수령 체크 AND 업로드파일(≥1) 둘 다 충족 시 회색/비활성(데이터 삭제 아님). 부분충족=활성 유지.
 *
 * 정적(빌드 산출 소스) 검증 — 선행 LABTAB-SPLIT spec 과 동일 스타일(데이터 계약/DB 상태 미의존, no-DDL).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');

test.describe('#1: 이력 역순 정렬 (검사신청일 내림차순)', () => {
  test('정렬 비교자가 b→a 내림차순(최신 위), 동일자 이름 가나다순', () => {
    const b = blood();
    // requestDate 내림차순: b.requestDate.localeCompare(a.requestDate)
    expect(b).toContain('b.requestDate.localeCompare(a.requestDate)');
    // 동일자 tie-break = 이름 ko collation 오름차순 유지
    expect(b).toContain("a.customerName.localeCompare(b.customerName, 'ko')");
    // 구(오름차순) 비교자는 제거되어야 함 — 회귀 방지
    expect(b).not.toContain('a.requestDate.localeCompare(b.requestDate)');
  });
});

test.describe('#2: [업로드] 컬럼 신규 + 기존 8컬럼 유지', () => {
  test('9번째 헤더 [업로드] 존재 + 행별 업로드 버튼', () => {
    const b = blood();
    // 신규 헤더
    expect(b).toContain('업로드');
    expect(b).toContain('data-testid="blood-upload-btn"');
    // 기존 8컬럼 헤더 전량 유지(회귀0)
    for (const col of ['순서', '검사일자', '환자명', '차트번호', '생년월일', '접수여부', '접수자명', '서류수령여부']) {
      expect(b).toContain(col);
    }
  });

  test('업로드 컬럼이 서류수령여부 뒤(마지막)에 배치', () => {
    const b = blood();
    const idxDocsHdr = b.indexOf('>서류수령여부<');
    const idxUploadHdr = b.indexOf('>업로드<');
    expect(idxDocsHdr).toBeGreaterThan(-1);
    expect(idxUploadHdr).toBeGreaterThan(idxDocsHdr);
  });

  test('업로드 버튼 라벨 분기 — 0건 업로드 / ≥1건 보기 (N)', () => {
    const b = blood();
    expect(b).toContain('업로드');
    expect(b).toContain('보기 (');
    expect(b).toContain('uploadN > 0');
  });
});

test.describe('#3: 업로드→2번차트 검사결과 자동반영 (경로 재사용)', () => {
  test('BloodResultDialog 재사용 — 신규 업로드 경로 정의 0', () => {
    const b = blood();
    expect(b).toContain("import BloodResultDialog from '@/components/BloodResultDialog'");
    expect(b).toContain('<BloodResultDialog');
    // 신규 patient_file_records insert 경로를 이 파일에서 직접 만들지 않는다(재사용).
    expect(b).not.toContain(".insert(metaRows)");
    expect(b).not.toMatch(/from\('patient_file_records'\)[\s\S]{0,80}\.insert/);
  });

  test("결과지 카운트는 kind='blood_result' + 공유 query key", () => {
    const b = blood();
    expect(b).toContain('useBloodResultCounts');
    expect(b).toContain("'blood_result'");
    // ExamTargetsSection·CustomerChartPage 와 동일 query key 공유 → 양방향 즉시 반영
    expect(b).toContain("queryKey: ['blood_result_counts', clinicId]");
    // 방어 폴백(테이블 미적용 prod)
    expect(b).toContain('42P01');
  });

  test('다이얼로그 닫힘 시 카운트 invalidate(라벨·완료판정 즉시 갱신)', () => {
    const b = blood();
    expect(b).toContain("qc.invalidateQueries({ queryKey: ['blood_result_counts', clinic?.id] })");
  });
});

test.describe('#4: 완료 행 자동 비활성 (서류수령 AND 업로드≥1)', () => {
  test('완료 판정 = docsReceived AND uploadCount>=1', () => {
    const b = blood();
    expect(b).toContain('const isComplete');
    expect(b).toContain('getState(r).docsReceived && uploadCountFor(r) >= 1');
  });

  test('완료 행 회색/비활성 스타일 + data-complete 마킹', () => {
    const b = blood();
    expect(b).toContain("data-complete={complete ? 'true' : 'false'}");
    // 회색(muted) + opacity 처리 — 데이터 삭제 아님(스타일만)
    expect(b).toContain('bg-muted/40');
    expect(b).toContain('opacity-60');
  });

  test('완료 시 접수/서류수령 체크박스·접수자명 입력 잠금(disabled)', () => {
    const b = blood();
    // LabCheckbox / ReceiverNameCell 에 disabled prop 전달
    expect(b).toContain('disabled={complete}');
    // disabled prop 지원(컴포넌트 정의)
    expect(b).toContain('disabled?: boolean');
    expect(b).toContain('disabled={disabled}');
  });

  test('완료여도 [업로드] 버튼은 열람/삭제(재활성 escape hatch) 위해 유지 — disabled 미적용', () => {
    const b = blood();
    // 업로드 버튼 블록에는 disabled 바인딩이 붙지 않는다(잠금 대상 3종만).
    const btnIdx = b.indexOf('data-testid="blood-upload-btn"');
    expect(btnIdx).toBeGreaterThan(-1);
    const btnBlock = b.slice(btnIdx - 200, btnIdx + 200);
    expect(btnBlock).not.toContain('disabled={complete}');
  });
});

test.describe('회귀: 선행 2티켓 계약 보존', () => {
  test('LABTAB-SPLIT — form_key/영속/색상/제목 유지', () => {
    const b = blood();
    expect(b).toContain("FORM_KEY = 'blood_reception_daily'");
    expect(b).toContain('피검사 일일 진행 리스트');
    expect(b).toContain('data-testid="blood-daily-table"');
    expect(b).toContain('data-testid="blood-daily-row"');
    expect(b).toContain("contains('field_data', { form_key: FORM_KEY })");
    // 활성 행 색상(핑크/노랑) 보존
    expect(b).toContain('bg-pink-50');
    expect(b).toContain('bg-yellow-50');
    // 리스트업 소스 보존
    expect(b).toContain("eq('blood_test_requested', true)");
  });
});
