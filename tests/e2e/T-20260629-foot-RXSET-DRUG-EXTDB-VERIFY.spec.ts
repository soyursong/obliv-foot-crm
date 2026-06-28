/**
 * E2E spec — T-20260629-foot-RXSET-DRUG-EXTDB-VERIFY
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH, ts 1782670122.914199):
 *   "다른약들이랑 표기가다른거로 봐서 정확한 외부 리소스에 검증 안넣은듯"
 *   → 약 검색·연결 시점에 외부 공식 약품DB(HIRA)를 source-of-truth로 3-key(상품명·성분명·코드)를
 *     대조 검증하고, 검증 상태(코드확인/미확인/대조전)를 현장에 배지로 표기. 검증 실패는 저장 비차단(additive).
 *
 * 본 착수분 = AC-2(매칭로직) + AC-4(검증배지 라이브 와이어링) + AC-5(graceful) + AC-6(비차단).
 *   · 1차 검증축 = HIRA 출처(code_source='official' / insurance_status_source='hira'). 외부 API 런타임 호출 0.
 *   · 자체 입력약(custom/LEGACY) = 외부 공식DB 미수록 → 'unverified'(미확인). ← reporter "표기 다른 약" 식별.
 *   · 식약처 성분축(2차) · 검증결과 영속 캐시(AC-3) · HIRA 명칭 인덱스 적재 = 후속 트랙(직렬화, 본 spec 비범위).
 *
 * Surface:
 *   - src/lib/drugVerification.ts            (AC-2 판정 모델 + computeDrugVerifyVerdict 순수 함수)
 *   - src/components/doctor/DrugVerifyBadge.tsx (AC-4 presentational 배지 + detail 대조 안내)
 *   - src/components/admin/DrugFoldersTab.tsx (AC-4 라이브 와이어링: 전체보기 행 + 검색 결과 배지)
 *
 * 형제 RXSET-* spec 동형 — 정본 소스 정적 단언(데이터/로그인 비의존) + 순수 판정 로직 단위 검증.
 * (drugVerification.ts 는 외부 import 0 순수 모듈 → 노드 컨텍스트 직접 import 안전.)
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeDrugVerifyVerdict,
  isExternalOfficialCode,
  describeVerifyStatus,
  verdictNeedsHumanCheck,
} from '../../src/lib/drugVerification';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MODEL = 'src/lib/drugVerification.ts';
const BADGE = 'src/components/doctor/DrugVerifyBadge.tsx';
const TAB = 'src/components/admin/DrugFoldersTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 매칭/판정 로직 — 외부 공식소스(HIRA) 출처 기반(순수 함수 단위 검증)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: insurance_status_source=hira → verified(월배치 급여목록 positively 매칭)', () => {
  expect(computeDrugVerifyVerdict({ code_source: 'custom', claim_code: 'LEGACY-1', insurance_status_source: 'hira' }))
    .toEqual({ status: 'verified' });
  expect(computeDrugVerifyVerdict({ code_source: 'official', claim_code: '642900010', insurance_status_source: 'hira' }))
    .toEqual({ status: 'verified' });
});

test('AC-2: code_source=official(실코드) → verified(HIRA 표준코드 master 출처)', () => {
  expect(computeDrugVerifyVerdict({ code_source: 'official', claim_code: '642900010' }))
    .toEqual({ status: 'verified' });
  // 대소문자/공백 정규화
  expect(computeDrugVerifyVerdict({ code_source: 'OFFICIAL', claim_code: '  642900010 ' }))
    .toEqual({ status: 'verified' });
});

test('AC-2: 자체 입력약(custom / LEGACY placeholder) → unverified(외부 공식DB 미수록)', () => {
  // reporter "표기 다른 약" = 자체 입력약 = 외부 미확인.
  expect(computeDrugVerifyVerdict({ code_source: 'custom', claim_code: 'LEGACY-abc' }))
    .toEqual({ status: 'unverified' });
  // code_source official 이어도 placeholder 코드면 실코드 아님 → unverified.
  expect(computeDrugVerifyVerdict({ code_source: 'official', claim_code: 'HIRA-STD-0001234567890' }))
    .toEqual({ status: 'unverified' });
  expect(computeDrugVerifyVerdict({ code_source: 'official', claim_code: 'HIRA-000000001' }))
    .toEqual({ status: 'unverified' });
});

test('AC-2: 퍼지/자동연결 금지 — 출처 불명·데이터 부족은 pending(자동 verified 안 함)', () => {
  expect(computeDrugVerifyVerdict({ code_source: '', claim_code: '' })).toEqual({ status: 'pending' });
  expect(computeDrugVerifyVerdict({ code_source: 'unknown', claim_code: '' })).toEqual({ status: 'pending' });
  // 코드만 있고 출처(official) 불명 → 자동 verified 금지(코드 1급은 official 출처일 때만).
  expect(computeDrugVerifyVerdict({ code_source: 'unknown', claim_code: '642900010' })).toEqual({ status: 'pending' });
});

test('AC-5: null/undefined 입력 → null 반환(배지 미렌더 — graceful, 에러 아님)', () => {
  expect(computeDrugVerifyVerdict(null)).toBeNull();
  expect(computeDrugVerifyVerdict(undefined)).toBeNull();
});

test('AC-2: isExternalOfficialCode — official 실코드만 true, placeholder/custom false', () => {
  expect(isExternalOfficialCode('642900010', 'official')).toBe(true);
  expect(isExternalOfficialCode('642900010', 'custom')).toBe(false);
  expect(isExternalOfficialCode('LEGACY-1', 'official')).toBe(false);
  expect(isExternalOfficialCode('', 'official')).toBe(false);
  expect(isExternalOfficialCode(null, 'official')).toBe(false);
});

test('AC-2/AC-4: unverified 는 사람확인 필요(현장 후속액션 유도), verified 는 불요', () => {
  expect(verdictNeedsHumanCheck({ status: 'unverified' })).toBe(true);
  expect(verdictNeedsHumanCheck({ status: 'verified' })).toBe(false);
  expect(verdictNeedsHumanCheck(null)).toBe(false);
  // 배지 라벨 = 현장 친화 한국어(개발용어 배제)
  expect(describeVerifyStatus('verified').label).toBe('코드확인');
  expect(describeVerifyStatus('unverified').label).toBe('미확인');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2/AC-3 경계: 본 착수분은 신규 DB 스키마/외부 API 호출 0 (직렬화 준수)
// ─────────────────────────────────────────────────────────────────────────────
test('경계: 판정 모델은 외부 import 0 순수 모듈(외부 호출/신규 패키지 0)', () => {
  const src = read(MODEL);
  // import 문 없음(React/Supabase/HTTP 의존 0) — 외부 런타임 호출 0.
  expect(/^\s*import\s/m.test(src)).toBe(false);
  // AC-3(영속 캐시 스키마) 보류 명시 — 추정 스키마 착수 금지.
  expect(src).toContain('AC-3');
  expect(src).toContain('신규 DB 스키마 0');
});

test('경계: DrugFoldersTab 가 신규 마이그/외부 fetch 를 추가하지 않음(기존 출처 필드만)', () => {
  const src = read(TAB);
  // 검증 배지는 기존 출처 필드(code_source/claim_code)로 산출 — 외부 fetch/HIRA API 호출 없음.
  expect(src).toContain('computeDrugVerifyVerdict');
  expect(src).not.toMatch(/fetch\(\s*['"`]https?:\/\//);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 검증 배지(presentational) — 미주입 안전 + detail 대조 안내 + variant 재사용
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: DrugVerifyBadge — verdict 없으면 미렌더(scaffold 안전), pending 기본 숨김', () => {
  expect(existsSync(join(ROOT, BADGE))).toBe(true);
  const src = read(BADGE);
  expect(src).toMatch(/if \(!verdict\) return null;/);
  expect(src).toMatch(/verdict\.status === 'pending' && !showPending.*return null/s);
  // 기존 ui/Badge variant 재사용(신규 패키지 0)
  expect(src).toContain("import { Badge } from '@/components/ui/badge'");
});

test('AC-4: 배지에 detail(내부 코드값) 결합 — "내부값 vs 외부 공식DB" 대조 안내(탭/hover)', () => {
  const src = read(BADGE);
  expect(src).toContain('detail');
  // 1차 툴팁 + detail 줄바꿈 결합
  expect(src).toMatch(/\$\{meta\.tooltip\}\\n\$\{detail\.trim\(\)\}/);
  expect(src).toContain('title={title}');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 라이브 와이어링 — 전체보기 행 + 검색 결과 배지(현장 노출)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1/2: 약 검색 결과에 외부DB 검증 배지 노출', () => {
  const src = read(TAB);
  expect(src).toContain("import DrugVerifyBadge from '@/components/doctor/DrugVerifyBadge'");
  expect(src).toContain('drug-folder-search-verify-badge');
  // 검색 결과(RxCodeResult: code_source/claim_code)로 판정
  expect(src).toMatch(/verdict=\{computeDrugVerifyVerdict\(code\)\}/);
});

test('시나리오1/2: 전체보기(약 마스터) 행에 외부DB 검증 배지 노출', () => {
  const src = read(TAB);
  expect(src).toContain('drug-folder-viewall-verify-badge');
  expect(src).toMatch(/verdict=\{computeDrugVerifyVerdict\(d\)\}/);
  // 내부 코드 대조 안내 detail 전달
  expect(src).toMatch(/detail=\{`내부 코드: \$\{d\.claim_code\}`\}/);
});

test('시나리오3(AC-6): 검증 배지는 표시 전용 — 저장/처방/분류를 차단하지 않음', () => {
  const src = read(TAB);
  // 배지는 기존 행/검색 동선에 부가 표시만 — 기존 분류(handleAssign)·삭제 동선 회귀 0.
  expect(src).toContain('handleAssign');
  expect(src).toContain('drug-folder-assign-result');
  // 검증 배지가 disabled/차단 분기를 만들지 않음(표시 전용).
  expect(src).not.toMatch(/computeDrugVerifyVerdict[^\n]*disabled/);
});
