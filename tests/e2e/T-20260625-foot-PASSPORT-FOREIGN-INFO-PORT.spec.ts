/**
 * E2E spec — T-20260625-foot-PASSPORT-FOREIGN-INFO-PORT
 *
 * 여권번호 기능 피부CRM(derm) 이식 → 풋.
 *   derm hold/passport-foreign-info-20260609 의 외국인 정보 그룹(국적/여권번호/만료일) +
 *   여권 스캔(클라이언트 OCR, MRZ 파싱) + 여권 MRZ 국가코드 → nationality_code 자동채움을 풋에 이식.
 *
 * 게이트(중요): 본 단계는 FE + MRZ 유틸 + 마이그 SQL '작성'까지. DB 마이그 apply는
 *   data-architect CONSULT GO + supervisor DDL-diff 후. 따라서 실 DB 생성/저장 흐름(컬럼 존재
 *   필요)은 마이그 적용 후 supervisor 정식 QA에서 검증한다. 본 spec은 데이터·로그인 비의존
 *   구조 불변식 + parseMrz 순수함수 동작으로 회귀를 가드한다.
 *
 * AC-1: MRZ 파서/OCR 유틸 이식 (mrz.ts / passport-ocr.ts).
 * AC-2: 외국인 정보 그룹(국적/여권번호/만료일) + 여권 스캔 버튼 = 카메라 촬영 전용(파일 업로드 제외).
 * AC-3: 여권 MRZ 국가코드 → nationality_code 자동채움(parseMrz nationalityAlpha3).
 * AC-4: 신규/수정 고객 모달 양쪽 배선 + insert/update 페이로드(is_foreign/passport/nationality/expiry).
 * AC-5: 마이그 additive·IF NOT EXISTS + rollback 동봉. tesseract.js(Apache-2.0) lazy import.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMrz, alpha3ToKoreanName } from '../../src/lib/mrz';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MRZ = 'src/lib/mrz.ts';
const OCR = 'src/lib/passport-ocr.ts';
const SECTION = 'src/components/ForeignInfoSection.tsx';
const CUSTOMERS = 'src/pages/Customers.tsx';
const TYPES = 'src/lib/types.ts';
const PKG = 'package.json';
const MIG = 'supabase/migrations/20260625120000_foreign_info_port_nationality_docexpiry.sql';
const MIG_RB = 'supabase/migrations/20260625120000_foreign_info_port_nationality_docexpiry.rollback.sql';

// ── AC-1: MRZ/OCR 유틸 이식 ───────────────────────────────────────────────────
test('AC-1: mrz.ts / passport-ocr.ts 이식 + 핵심 export 존재', () => {
  const mrz = read(MRZ);
  expect(mrz).toContain('export function parseMrz');
  expect(mrz).toContain('export function alpha3ToKoreanName');
  const ocr = read(OCR);
  expect(ocr).toContain('export async function scanPassportImage');
  // 클라이언트 OCR: tesseract.js dynamic import(메인 번들 미포함) + 이미지 미저장 가드
  expect(ocr).toContain("await import('tesseract.js')");
  expect(ocr).toContain('URL.revokeObjectURL');
  expect(ocr).toContain('worker.terminate');
});

// ── AC-3: parseMrz 순수함수 — 여권 국가코드 → nationalityAlpha3 ───────────────
test('AC-3: parseMrz TD3 표본 파싱 — 국적/여권번호/생년월일/성별', () => {
  // ICAO 9303 TD3 표본(2줄 × 44자)
  const sample = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<<',
    'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
  ].join('\n');
  const r = parseMrz(sample);
  expect(r).not.toBeNull();
  expect(r!.nationalityAlpha3).toBe('UTO');
  expect(r!.passportNumber).toBe('L898902C3');
  expect(r!.birthDate).toBe('1974-08-12');
  expect(r!.gender).toBe('f');
  expect(r!.surname).toBe('ERIKSSON');
});

test('AC-3: alpha3ToKoreanName — 수록 코드 매핑 + 미수록 null', () => {
  expect(alpha3ToKoreanName('KOR')).toBe('대한민국');
  expect(alpha3ToKoreanName('USA')).toBe('미국');
  expect(alpha3ToKoreanName('UTO')).toBeNull();
  expect(alpha3ToKoreanName(null)).toBeNull();
});

// ── AC-2: 외국인 정보 그룹 + 여권 스캔(카메라 촬영 전용, 파일 업로드 제외) ──────
test('AC-2: ForeignInfoSection — 국적/여권번호/만료일 필드 + 카메라 촬영 전용 스캔', () => {
  const sec = read(SECTION);
  // 3 필드 + 스캔 버튼 testid
  expect(sec).toContain('data-testid="foreign-nationality"');
  expect(sec).toContain('data-testid="foreign-passport"');
  expect(sec).toContain('data-testid="foreign-doc-expiry"');
  expect(sec).toContain('data-testid="passport-scan-btn"');
  expect(sec).toContain('여권 스캔하기');
  // 카메라 촬영 전용: capture="environment" (파일 선택 UI는 hidden input 1개뿐)
  expect(sec).toContain('capture="environment"');
  expect(sec).toContain('accept="image/*"');
  // 스캔 → MRZ 파싱 유틸 사용
  expect(sec).toContain('scanPassportImage');
  expect(sec).toContain('alpha3ToKoreanName');
  // PII 가드 문구(원본 이미지 미저장)
  expect(sec).toContain('저장되지 않습니다');
});

// ── AC-4: 신규/수정 고객 모달 배선 + 저장 페이로드 ────────────────────────────
test('AC-4: Customers.tsx — 신규/수정 모달 ForeignInfoSection 배선', () => {
  const c = read(CUSTOMERS);
  expect(c).toContain("import ForeignInfoSection");
  // 신규/수정 양쪽에서 사용 (최소 2회 렌더)
  const renders = c.match(/<ForeignInfoSection/g) ?? [];
  expect(renders.length).toBeGreaterThanOrEqual(2);
});

test('AC-4: insert/update 페이로드 — is_foreign/passport_number/nationality_code/foreign_doc_expiry', () => {
  const c = read(CUSTOMERS);
  expect(c).toContain('nationality_code:');
  expect(c).toContain('foreign_doc_expiry:');
  expect(c).toContain('passport_number:');
  expect(c).toContain('is_foreign:');
});

test('AC-4: Customer 타입에 nationality_code / foreign_doc_expiry 추가', () => {
  const t = read(TYPES);
  expect(t).toContain('nationality_code?: string | null;');
  expect(t).toContain('foreign_doc_expiry?: string | null;');
});

// ── AC-5: 마이그 additive + rollback + tesseract.js 의존 ───────────────────────
test('AC-5: 마이그 additive·IF NOT EXISTS + rollback 동봉', () => {
  const up = read(MIG);
  expect(up).toContain('ADD COLUMN IF NOT EXISTS nationality_code TEXT');
  expect(up).toContain('ADD COLUMN IF NOT EXISTS foreign_doc_expiry DATE');
  // apply 게이트 명시 (ungated 배포 방지)
  expect(up).toContain('APPLY GATE');
  const rb = read(MIG_RB);
  expect(rb).toContain('DROP COLUMN IF EXISTS foreign_doc_expiry');
  expect(rb).toContain('DROP COLUMN IF EXISTS nationality_code');
});

test('AC-5: tesseract.js 의존성 등록(클라이언트 OCR 엔진)', () => {
  const pkg = JSON.parse(read(PKG)) as { dependencies?: Record<string, string> };
  expect(pkg.dependencies?.['tesseract.js']).toBeTruthy();
});
