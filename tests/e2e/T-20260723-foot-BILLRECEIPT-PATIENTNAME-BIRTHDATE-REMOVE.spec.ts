/**
 * T-20260723-foot-BILLRECEIPT-PATIENTNAME-BIRTHDATE-REMOVE
 *
 * 진료비 계산서·영수증(신양식 bill_receipt_new) 성명칸에서 생년월일 서브라인 제거.
 * (현장 이은상 팀장 요청 C0ATE5P6JTH. db_change=false — 렌더 표시층 1줄 제거 한정.)
 *
 *   변경: <td>{{patient_name}}<br><span class="rn-sub">생년월일 {{patient_birthdate}}</span></td>
 *      →  <td>{{patient_name}}</td>
 *
 * 회귀 차단(주의사항):
 *   - {{patient_birthdate}} 토큰·바인딩 삭제 금지 (진단서류 등 타 양식 L693 사용 중).
 *   - .rn-sub CSS·field_map의 patient_birthdate 는 고아 처리(무해) → 무접촉.
 *   - 구양식 bill_receipt 는 이미 제거됨 — 신양식만 대상.
 *
 * 라이브 앱 회귀 아님 — 템플릿 렌더/바인딩 불변식(로그인 불요, 결정론적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractTemplate(name: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${name} 상수 존재`).not.toBeNull();
  return m![1];
}
const NEW_TPL = extractTemplate('BILL_RECEIPT_NEW_HTML');
// HTML 주석 제거본 — 렌더 마크업만 검사(주석 내 history 문구 오탐 방지).
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');
const NEW_TPL_NC = stripComments(NEW_TPL);

test.describe('BILLRECEIPT-PATIENTNAME-BIRTHDATE-REMOVE — 신양식 성명칸 생년월일 서브라인 제거', () => {
  // ── 시나리오 1: 신양식 성명칸에 이름만 (생년월일 서브라인 미표시) ──

  test('성명칸: 환자 성명 라벨 다음 셀은 {{patient_name}} 단독', () => {
    expect(NEW_TPL).toMatch(/<td class="rn-lbl">환자 성명<\/td>\s*<td>\{\{patient_name\}\}<\/td>/);
  });

  test('성명칸: 생년월일 서브라인(rn-sub) 마크업 소멸', () => {
    // 성명칸 셀에 <br><span class="rn-sub">생년월일 ...</span> 조합이 없어야 함.
    expect(NEW_TPL_NC).not.toMatch(/\{\{patient_name\}\}<br><span class="rn-sub">생년월일 \{\{patient_birthdate\}\}<\/span>/);
    // 신양식 템플릿 렌더 마크업에 '생년월일' 리터럴 자체가 없음.
    expect(NEW_TPL_NC).not.toContain('생년월일');
  });

  test('성명칸: 신양식 템플릿에 {{patient_birthdate}} 토큰 미사용(성명칸이 유일 사용처였음)', () => {
    expect(NEW_TPL_NC).not.toContain('{{patient_birthdate}}');
  });

  // ── 시나리오 2: 타 양식 회귀 없음 (patient_birthdate 토큰/바인딩 보존) ──

  test('회귀0: {{patient_birthdate}} 토큰은 파일 전역에서 보존(진단서류 등 타 양식 사용 중)', () => {
    const count = (HTML_SRC.match(/\{\{patient_birthdate\}\}/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('회귀0: .rn-sub CSS 클래스 정의 보존(고아 처리·무해)', () => {
    expect(HTML_SRC).toContain('.rn-sub');
  });

  // ── 공통 금지선: 나머지 칸·레이아웃 불변 ──

  test('금지선: 환자등록번호·진료기간 등 인접 헤더 셀 불변', () => {
    expect(NEW_TPL).toMatch(/<td class="rn-lbl">환자등록번호<\/td><td>\{\{record_no\}\}<\/td>/);
    expect(NEW_TPL).toMatch(/<td class="rn-lbl">진료기간<\/td><td>\{\{visit_date\}\}<\/td>/);
  });
});
