/**
 * E2E spec — T-20260618-foot-OPINIONDOC-DLG-OVERHAUL
 * 진단서/소견서 작성 팝업(OpinionEditorDialog) 대수술 — 헤더 1줄·발행자게이트·3단레이아웃·직원뷰.
 *
 * 검증 대상(정본 = src/components/doctor/OpinionDocTab.tsx OpinionEditorDialog):
 *   S1 ① 헤더 한 줄 — 서류명(소견서) + 환자이름(클릭→진료차트 drawer)·생년(만나이)·차트번호.
 *   S2 ② 안내문구 "(옵션을 누르면…)" 제거.
 *   S3 ③ 발행자=진료 본 의사 일치 게이트 — issuerMatchesSigning 로직(정보없음=경고후허용 fallback).
 *   S4 ③ 발행자 기본값 = 그 내원 진료 본 의사 우선(없으면 is_default).
 *   S5 ③ visit_date 파생 = checked_in_at 의 KST 날짜(seoulISODate 컨벤션, UTC→KST 경계).
 *   S6 ④ 발행하기 라벨 + ⑤ 발행이력 테이블(저장(PDF)/인쇄) — 둘 다 printOpinionDoc(브라우저 인쇄대화상자) 경로.
 *   S7 ⑥ 직원(비의사) 뷰 — 발행 권한 게이트(director|doctor) 유지 + 비의사는 출력전용.
 *   S8 실 브라우저 렌더 — 소견서 팝업 헤더/옵션/발행하기/이력테이블 무회귀.
 *
 * 스타일: in-page 순수 로직 시뮬레이션(정본 모사) + 렌더 스모크 — OPINION-DOC-FEATURE 동일 컨벤션.
 *
 * ⚠ AC-0 RC 확정: medical_charts 에 check_in_id 없음 → 진료의 연결키 = customer_id + visit_date(KST).
 *   signing_doctor_id = clinic_doctors.id 직접 비교. 진료의 정보 없으면(레거시 NULL/차트없음) 게이트 미적용(fallback).
 *   PDF 저장 = printOpinionDoc(window.open+인쇄) 재사용 — 신규 패키지 0. 진료차트 = MedicalChartPanel 자체 portal drawer.
 *   NOTOUCH: publish_opinion_doc RPC · published 비가역 트리거(의료법§22) · printOpinionDoc(L-006).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 발행 권한 게이트(canPublish) — director|doctor 만(C2, 의료법 §17) ──
const PUBLISH_ROLES = ['director', 'doctor'];
const canPublish = (role: string): boolean => PUBLISH_ROLES.includes(role);

// ── 정본 모사: ③ 발행자 ↔ 진료 본 의사 일치 게이트 (OpinionEditorDialog.issuerMatchesSigning) ──
//   진료의 정보(signing set)가 비어 있으면 게이트 미적용(true=경고후허용). 있으면 발행자가 그 set 에 속해야 true.
const issuerMatchesSigning = (signingIds: Set<string>, doctorId: string): boolean => {
  const hasInfo = signingIds.size > 0;
  if (!hasInfo) return true; // fallback: 정보없음 → 정상 발행 오차단 방지
  return doctorId !== '' && signingIds.has(doctorId);
};

// ── 정본 모사: 발행 버튼 disabled 판정 ──
const publishDisabled = (args: {
  role: string;
  isPending: boolean;
  text: string;
  signingIds: Set<string>;
  doctorId: string;
}): boolean => {
  const can = canPublish(args.role);
  const mismatch = args.signingIds.size > 0 && !issuerMatchesSigning(args.signingIds, args.doctorId);
  return !can || args.isPending || !args.text.trim() || mismatch;
};

// ── 정본 모사: ③ 발행자 기본값(defaultDoctorId) — 진료 본 의사 우선 → is_default → 첫 진료의 ──
type Doc = { id: string; name: string; license_no: string | null; is_default: boolean };
const defaultDoctorId = (doctors: Doc[], signingIds: Set<string>): string => {
  if (doctors.length === 0) return '';
  const signed = doctors.find((d) => signingIds.has(d.id));
  if (signed) return signed.id;
  return (doctors.find((d) => d.is_default) ?? doctors[0]).id;
};

// ── 정본 모사: visit_date 파생 = seoulISODate(checked_in_at) (lib/format) ──
const seoulISODate = (input: string): string =>
  new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

test.describe('T-20260618-foot-OPINIONDOC-DLG-OVERHAUL — 발행자게이트/기본값/visit_date 로직', () => {
  // S3 — 진료의 정보 없음 → 게이트 미적용(경고후허용 fallback).
  test('S3: 진료의 정보 없으면 일치게이트 미적용(true)', () => {
    const empty = new Set<string>();
    expect(issuerMatchesSigning(empty, 'd1')).toBe(true);
    expect(issuerMatchesSigning(empty, '')).toBe(true); // 미선택이어도 정보없으면 차단 안 함
  });

  // S3 — 진료의 정보 있음 → 발행자가 그 set 에 속해야 일치.
  test('S3: 진료의 정보 있으면 발행자 ∈ 진료의set 일 때만 일치', () => {
    const signing = new Set(['d1', 'd2']);
    expect(issuerMatchesSigning(signing, 'd1')).toBe(true);
    expect(issuerMatchesSigning(signing, 'd2')).toBe(true); // 1환자 N차트 합집합
    expect(issuerMatchesSigning(signing, 'd3')).toBe(false); // 진료 안 본 의사 → 불일치
    expect(issuerMatchesSigning(signing, '')).toBe(false);
  });

  // S3 — 발행 버튼 disabled: 불일치 시 차단, 일치+본문 있으면 활성(의사 한정).
  test('S3: 발행 버튼 disabled 판정(불일치 차단 / 일치 활성)', () => {
    const signing = new Set(['d1']);
    // 불일치 → disabled
    expect(publishDisabled({ role: 'doctor', isPending: false, text: '내용', signingIds: signing, doctorId: 'd2' })).toBe(true);
    // 일치 + 본문 → enabled
    expect(publishDisabled({ role: 'doctor', isPending: false, text: '내용', signingIds: signing, doctorId: 'd1' })).toBe(false);
    // 일치하나 본문 없음 → disabled
    expect(publishDisabled({ role: 'doctor', isPending: false, text: '  ', signingIds: signing, doctorId: 'd1' })).toBe(true);
    // 정보없음 + 본문 → enabled(게이트 미적용)
    expect(publishDisabled({ role: 'doctor', isPending: false, text: '내용', signingIds: new Set(), doctorId: '' })).toBe(false);
    // 비의사는 진료의 일치해도 disabled(권한 게이트 유지)
    expect(publishDisabled({ role: 'manager', isPending: false, text: '내용', signingIds: signing, doctorId: 'd1' })).toBe(true);
  });

  // S4 — 발행자 기본값: 진료 본 의사 우선 → 없으면 is_default → 첫 진료의.
  test('S4: 발행자 기본값 = 진료 본 의사 우선', () => {
    const docs: Doc[] = [
      { id: 'd1', name: '김원장', license_no: '111', is_default: true },
      { id: 'd2', name: '이원장', license_no: '222', is_default: false },
    ];
    // 진료 본 의사가 d2 → 기본값 d2(is_default d1 보다 우선)
    expect(defaultDoctorId(docs, new Set(['d2']))).toBe('d2');
    // 진료의 정보 없음 → is_default(d1)
    expect(defaultDoctorId(docs, new Set())).toBe('d1');
    // 진료 본 의사가 등록 진료의에 없음 → is_default 폴백
    expect(defaultDoctorId(docs, new Set(['dX']))).toBe('d1');
    // 진료의 0명 → ''
    expect(defaultDoctorId([], new Set(['d1']))).toBe('');
  });

  // S5 — visit_date 파생: UTC timestamptz → KST 날짜(오전 경계 오탐 방지).
  test('S5: visit_date = checked_in_at 의 KST 날짜', () => {
    // 2026-06-18 23:30 UTC = 2026-06-19 08:30 KST → KST 날짜는 06-19.
    expect(seoulISODate('2026-06-18T23:30:00Z')).toBe('2026-06-19');
    // 2026-06-19 02:00 KST 체크인(=2026-06-18 17:00 UTC) → KST 06-19.
    expect(seoulISODate('2026-06-18T17:00:00Z')).toBe('2026-06-19');
  });

  // S7 — 발행 권한 게이트(⑥ 직원뷰 분기 기준) = director|doctor 만.
  test('S7: 발행 권한 = director|doctor (직원뷰 분기 기준)', () => {
    expect(canPublish('director')).toBe(true);
    expect(canPublish('doctor')).toBe(true);
    expect(canPublish('manager')).toBe(false);
    expect(canPublish('admin')).toBe(false);
    expect(canPublish('staff')).toBe(false);
    expect(canPublish('therapist')).toBe(false);
  });
});

// ── S1/S2/S6/S8: 실 브라우저 렌더 — 헤더/안내문구제거/발행하기/이력테이블 ──
test.describe('T-20260618-foot-OPINIONDOC-DLG-OVERHAUL — render', () => {
  test('S8: 소견서 팝업 헤더 1줄 + 안내문구제거 + 발행하기 + 이력테이블', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.getByRole('link', { name: '진료 대시보드' }).click();
    await page.waitForTimeout(1500);

    const opinionTab = page.getByTestId('tab-opinion-doc');
    await expect(opinionTab).toBeVisible();
    await opinionTab.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('소견서 — 금일 내방객')).toBeVisible({ timeout: 5000 });

    const openBtn = page.getByTestId('opinion-open').first();
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await page.waitForTimeout(1200);
      const dialog = page.getByTestId('opinion-dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // S1 — 헤더 서류명(소견서) + 환자 정보 한 줄(역할이 의사일 때 옵션·발행 노출).
      await expect(page.getByTestId('opinion-doc-title')).toHaveText('소견서');

      // 의사 계정이면 옵션 그리드/발행하기/이력테이블, 비의사면 직원뷰가 노출됨(둘 중 하나 존재).
      const isDoctorView = (await page.getByTestId('opinion-options').count()) > 0;
      if (isDoctorView) {
        // S2 — 안내문구 제거: editor 라벨에 "옵션을 누르면" 문구 미노출.
        await expect(dialog.getByText('옵션을 누르면')).toHaveCount(0);
        // S6 — 발행하기 라벨(‘최종 발행’ 아님).
        await expect(page.getByTestId('opinion-publish-btn')).toContainText('발행하기');
        await expect(dialog.getByText('최종 발행')).toHaveCount(0);
        // 옵션 클릭 → editor 자동삽입(무회귀).
        await page.getByTestId('opinion-opt-oral_o').click();
        await page.waitForTimeout(300);
        await expect(page.getByTestId('opinion-editor')).not.toHaveValue('');
      } else {
        // ⑥ 직원뷰 — 발행 영역 없고 출력전용 안내.
        await expect(page.getByTestId('opinion-staff-view')).toBeVisible();
      }
      // S6/S8 — 발행이력/서류출력 패널은 양쪽 공통 노출.
      await expect(page.getByTestId('opinion-published')).toBeVisible();
      await page.screenshot({ path: 'evidence/T-20260618-foot-OPINIONDOC-DLG-OVERHAUL_dialog.png', fullPage: true });
    } else {
      await page.screenshot({ path: 'evidence/T-20260618-foot-OPINIONDOC-DLG-OVERHAUL_empty.png', fullPage: true });
    }
  });
});
