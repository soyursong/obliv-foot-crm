/**
 * T-20260728-foot-LABTAB-BLOODLIST-COMPACT-DENSITY
 *
 * 치료테이블 > 피검사 탭('피검사 일일 진행 리스트') 행간·셀 패딩 축소 → 컴팩트(밀도↑).
 *   목표 = 진료환자목록(진료알림판) 밀도 수준. 선례 재사용:
 *     · DOCDASH-POSTDEPLOY-REFINE-5 (진료알림판 셀 px-1.5 py-1)
 *     · MEDCHART-TABLE-COLWIDTH-TIGHTEN (T-20260718)
 *   순수 CSS/className 변경. DB·로직·컬럼셋·색상·데이터 계약 무변경(no-DDL).
 *
 * 검증 포인트:
 *   1. th/td 세로 패딩 축소: 구 px-2 py-2(th)·px-2 py-1.5(td) 제거 → px-1.5 py-1 적용.
 *   2. 테이블/헤더 폰트 축소: text-[13px]→[12px] / 헤더 [12px]→[11px].
 *   3. 체크박스 h-6→h-5(탭영역 20px 유지 = 클릭영역 과손상 없음).
 *   4. 접수자 select·업로드 버튼 세로 패딩 축소(py-1→py-0.5).
 *   5. 회귀 방지 — 8+2컬럼 헤더·색상 배경(pink/yellow/teal)·data-testid 전량 유지.
 *
 * 정적(빌드 산출 소스) 검증 — 선행 LABTAB-SPLIT/4FIX spec 과 동일 스타일(데이터 계약/DB 상태 미의존).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');

test.describe('1: th/td 세로 패딩 축소 (진료환자목록 밀도)', () => {
  test('구 padding(px-2 py-2 th / px-2 py-1.5 td)이 코드에서 제거됨', () => {
    const b = blood();
    // JSX 실제 className 안에서만 검사 (주석 텍스트 오탐 방지)
    const jsxOnly = b
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(jsxOnly).not.toContain('px-2 py-2 whitespace-nowrap');
    expect(jsxOnly).not.toContain('px-2 py-1.5');
  });

  test('컴팩트 padding(px-1.5 py-1)이 헤더/바디 셀에 적용됨', () => {
    const b = blood();
    // 헤더 th (순서 컬럼 등) + 바디 td 공통 px-1.5 py-1
    expect(b).toContain('px-1.5 py-1 whitespace-nowrap');
    expect(b).toContain('px-1.5 py-1');
  });
});

test.describe('2: 폰트 축소', () => {
  test('테이블 본문 text-[12px], 헤더 행 text-[11px]', () => {
    const b = blood();
    expect(b).toContain('border-collapse text-[12px]');
    expect(b).toContain('text-center text-[11px] font-semibold');
    // 구 폰트 제거(회귀 방지)
    expect(b).not.toContain('border-collapse text-[13px]');
    expect(b).not.toContain('text-center text-[12px] font-semibold text-foreground');
  });
});

test.describe('3: 체크박스 클릭영역 (h-5 w-5 = 20px, 과손상 없음)', () => {
  test('LabCheckbox h-5 w-5 로 축소, 구 h-6 w-6 제거', () => {
    const b = blood();
    expect(b).toContain('inline-flex h-5 w-5 items-center justify-center rounded-[3px] border-2');
    expect(b).not.toContain('inline-flex h-6 w-6 items-center justify-center rounded-[3px] border-2');
    // 체크 아이콘도 축소
    expect(b).toContain('h-3.5 w-3.5 ${checkColor}');
  });
});

test.describe('4: 접수자 select / 업로드 버튼 세로 패딩 축소', () => {
  test('접수자 select py-0.5 text-[12px]', () => {
    const b = blood();
    expect(b).toContain('bg-transparent px-1.5 py-0.5 text-[12px] text-red-700');
    expect(b).not.toContain('bg-transparent px-1.5 py-1 text-[13px] text-red-700');
  });

  test('접수자명 셀 td py-0.5', () => {
    const b = blood();
    expect(b).toContain('border-r px-1 py-0.5 ${complete');
  });

  test('업로드 버튼 py-0.5', () => {
    const b = blood();
    expect(b).toContain('border border-teal-300 bg-white px-2 py-0.5 text-[12px]');
  });
});

test.describe('5: 회귀 방지 — 컬럼셋·색상·testid 유지', () => {
  test('8+2 컬럼 헤더 전량 유지', () => {
    const b = blood();
    for (const col of ['순서', '검사일자', '환자명', '차트번호', '생년월일', '접수여부', '접수자명', '서류수령여부', '업로드']) {
      expect(b).toContain(col);
    }
  });

  test('색상 배경(pink/yellow/teal) 유지', () => {
    const b = blood();
    expect(b).toContain('bg-pink-100');
    expect(b).toContain('bg-yellow-100');
    expect(b).toContain('bg-teal-100');
    expect(b).toContain('bg-pink-50');
    expect(b).toContain('bg-yellow-50');
  });

  test('핵심 data-testid 유지', () => {
    const b = blood();
    for (const id of [
      'blood-daily-section',
      'blood-daily-table',
      'blood-daily-row',
      'blood-receiver-select',
      'blood-upload-btn',
    ]) {
      expect(b).toContain(`data-testid="${id}"`);
    }
    // 체크박스 testid 는 LabCheckbox 프롭으로 전달됨(testid="...")
    expect(b).toContain('testid="blood-received-checkbox"');
    expect(b).toContain('testid="blood-docs-checkbox"');
  });
});
