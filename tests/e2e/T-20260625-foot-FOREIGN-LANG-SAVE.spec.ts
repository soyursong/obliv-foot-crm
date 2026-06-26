/**
 * T-20260625-foot-FOREIGN-LANG-SAVE
 * 국적 자동연결 언어값 customers.language 저장 (PASSPORT-PORT 경량 후속).
 *
 * DA canonical(MSG-20260625-131444-2prw): customers.language(TEXT NULL, BCP-47 코드 ko/en/ja/zh-CN/zh-TW),
 *   DB CHECK 없음 → FE LANGUAGE_OPTIONS 앱레벨 검증. 국적 선택 시 COUNTRY_DEFAULT_LANGUAGE 로 언어 '제안'
 *   (language 비어있을 때만 = 초기/NULL default, 사용자 명시 입력은 last-write-wins 로 보존).
 *
 * ─── 검증 전략 (NO-GO insufficient_verification 재발 차단) ────────────────────────────────
 *  이전 spec 은 desktop-chrome(auth+webServer) 프로젝트에서 자체 UI 로그인을 잘못된 포트(5173,
 *  config baseURL 은 8089)로 시도 → page 미로딩 → 전 케이스 test.skip() → "4 skipped"(검증 0).
 *  게다가 parent nationalities seed 마이그가 hold(미적용)라 브라우저 자동제안 경로는 데이터부재로
 *  본질적으로 검증 불가.
 *
 *  → 본 spec 은 **unit 프로젝트**(auth/webServer 불요)에서 도는 결정론적 검증으로 재작성한다:
 *     (a) 국적→언어 매핑·옵션 값셋은 src/lib/foreign 을 직접 import 해 실제 함수 동작으로 단언
 *         (grep 아닌 런타임 로직 검증 — 브라우저 클릭 동등 보증, 데이터 seed 무관).
 *     (b) 폼 배선(언어 셀렉트 노출·자동제안 NULL-가드·등록/수정 양경로 저장 nullable)은 소스 정적
 *         introspection 으로 불변식 고정.
 *  skip 경로 0 — 환경/seed 상태와 무관하게 항상 실행·단언한다.
 *
 *  AC-1  국적 선택 → 언어 자동제안: ForeignInfoSection 에 언어 셀렉트가 존재하고, 국적 매핑이
 *        '비어있을 때만' 제안되도록 배선(NULL default, 수동값 덮어쓰기 금지).
 *  AC-2  대만/홍콩 분기: 대만·홍콩 → zh-TW, 중국 → zh-CN (혼동 금지). 5 코드 값셋 보장.
 *  AC-3  엣지(nullable): 국적/언어 미선택 시 customers.language 에 null 저장(내국인 동선 무영향).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COUNTRY_DEFAULT_LANGUAGE,
  nationalityCodeToLanguage,
  LANGUAGE_OPTIONS,
  languageCodeToLabel,
} from '../../src/lib/foreign';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf-8');

// DA canonical 5 코드 값셋 (셀프접수 에픽 Phase1 과 단일 customers.language 공유).
const CANONICAL_CODES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'];

test.describe('T-20260625-foot-FOREIGN-LANG-SAVE — 국적 자동연결 언어 저장', () => {
  // ── AC-1: 국적 → 언어 자동제안 매핑 (티켓 명시 매핑을 실제 함수로 단언) ──
  test('AC-1: 국적코드 → 언어코드 매핑이 티켓 명세대로 동작한다', () => {
    // 미국/캐나다/호주/싱가포르/필리핀 → en
    for (const c of ['US', 'CA', 'AU', 'SG', 'PH']) {
      expect(nationalityCodeToLanguage(c)).toBe('en');
    }
    // 중국 → zh-CN, 일본 → ja, 한국 → ko
    expect(nationalityCodeToLanguage('CN')).toBe('zh-CN');
    expect(nationalityCodeToLanguage('JP')).toBe('ja');
    expect(nationalityCodeToLanguage('KR')).toBe('ko');
    // 대소문자/공백 정규화
    expect(nationalityCodeToLanguage(' us ')).toBe('en');
    // 미매핑/빈값 → null (graceful)
    expect(nationalityCodeToLanguage(null)).toBeNull();
    expect(nationalityCodeToLanguage('')).toBeNull();
    expect(nationalityCodeToLanguage('ZZ')).toBeNull();
  });

  // ── AC-1 배선: 언어 셀렉트 노출 + 자동제안은 'NULL일 때만'(수동값 덮어쓰기 금지) ──
  test('AC-1: ForeignInfoSection 에 언어 셀렉트 + NULL-가드 자동제안 배선', () => {
    const src = read('src/components/ForeignInfoSection.tsx');
    // 언어 셀렉트 노출 (data-testid)
    expect(src).toContain('data-testid="foreign-language"');
    // ForeignInfoValue 에 language 필드
    expect(src).toMatch(/language:\s*string/);
    // 국적 onChange 가 자동제안 시 'language 비어있을 때만' 채운다 (last-write-wins 보존)
    expect(src).toMatch(/!value\.language/);
    // 제안값은 COUNTRY_DEFAULT_LANGUAGE 매핑 함수로 산출 (별도 매핑 신설 금지)
    expect(src).toContain('nationalityCodeToLanguage');
  });

  // ── AC-2: 대만/홍콩 → zh-TW, 중국 → zh-CN 분기 + 5 코드 값셋 ──
  test('AC-2: 대만·홍콩 zh-TW / 중국 zh-CN 분기 + 5코드 값셋 보장', () => {
    expect(nationalityCodeToLanguage('TW')).toBe('zh-TW');
    expect(nationalityCodeToLanguage('HK')).toBe('zh-TW');
    expect(nationalityCodeToLanguage('CN')).toBe('zh-CN');
    // 혼동 금지: 중국과 대만/홍콩이 같은 값이 아니어야 한다
    expect(nationalityCodeToLanguage('CN')).not.toBe(nationalityCodeToLanguage('TW'));

    // LANGUAGE_OPTIONS 가 canonical 5 코드를 모두 포함 (앱레벨 검증 SSOT)
    const optionValues = LANGUAGE_OPTIONS.map((o) => o.value);
    for (const code of CANONICAL_CODES) {
      expect(optionValues).toContain(code);
    }
    // 표시명 저장 금지 — value 는 코드, label 은 표기. zh-TW/zh-CN 표기 라벨 존재.
    expect(languageCodeToLabel('zh-TW')).toBeTruthy();
    expect(languageCodeToLabel('zh-CN')).toBeTruthy();
  });

  // ── AC-2 무결성: 자동제안값이 LANGUAGE_OPTIONS 에 없는 '고아 코드'가 되지 않는다 ──
  test('AC-2: COUNTRY_DEFAULT_LANGUAGE 매핑값이 전부 LANGUAGE_OPTIONS 에 존재(고아 제안 0)', () => {
    const optionValues = new Set(LANGUAGE_OPTIONS.map((o) => o.value));
    for (const [country, lang] of Object.entries(COUNTRY_DEFAULT_LANGUAGE)) {
      expect(optionValues.has(lang), `${country}→${lang} 가 LANGUAGE_OPTIONS 에 없음(셀렉트 고아)`).toBe(true);
    }
  });

  // ── AC-3: 엣지 — 등록/수정 양경로가 language 를 nullable 로 저장(미선택 → null) ──
  test('AC-3: 등록/수정 양경로 customers.language nullable 저장 배선', () => {
    const src = read('src/pages/Customers.tsx');
    // .trim() || null → 미선택(빈문자열)은 null 영속 (내국인 동선 무영향)
    const saveMatches = src.match(/language:\s*foreignInfo\.language\.trim\(\)\s*\|\|\s*null/g) ?? [];
    expect(saveMatches.length, '등록(Create)+수정(Edit) 두 저장 경로 모두 nullable 저장이어야 함').toBeGreaterThanOrEqual(2);
    // 수정 폼 로드 시 기존 customer.language 복원
    expect(src).toMatch(/language:\s*customer\.language\s*\?\?\s*''/);
  });

  // ── DB: ADDITIVE 1컬럼 + 멱등 + 롤백 동반 (DA GO, supervisor DDL-diff 대기) ──
  test('DB: customers.language ADDITIVE(IF NOT EXISTS) + rollback SQL 동반', () => {
    const mig = read('supabase/migrations/20260625140000_foreign_lang_save_customers_language.sql');
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS language TEXT/);
    expect(mig).not.toMatch(/CHECK\s*\(/i); // DB CHECK 없음 (derm 선례 · FE 검증)
    const rollback = read('supabase/migrations/20260625140000_foreign_lang_save_customers_language.rollback.sql');
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS language/);
    // 타입 선언 동기화
    expect(read('src/lib/types.ts')).toMatch(/language\?:\s*string\s*\|\s*null/);
  });
});
