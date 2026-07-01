/**
 * T-20260701-foot-DESIGNATED-STAFF-SHEET-MATCH-GUARD
 *   지정 담당(0순위)이 실제 출근했으나 구글시트 근무캘린더 '이름매칭 실패'(시트 장애/표기 불일치)로
 *   workingIds 에 안 잡혀 자동배정 fallback(균등배정)으로 빠지는 케이스를 감지·로깅·운영자 힌트로
 *   표면화한다. '지정치료사인데 왜 균등배정?' 오인 민원의 원인(시트 미매칭 vs 임시off)을 구분해 보게 함.
 *
 * ── 불변식(정적 소스 검증, 라이브 env 비의존 — autoAssign 엔진 dominant 패턴) ──────────
 *   AC-1: 지정자 fallback 건에서 원인이 로그/노출로 식별 가능 — 배정 결과 자체는 변경 없음.
 *   AC-2: 운영자가 '시트 미매칭(not_in_working_ids) vs 임시off(temp_off)' 를 구분해 볼 수 있음.
 *   AC-3: 자동배정 정본 우선순위(지정 0순위→월균등→기본순번) 로직 무변경(정본 spec 회귀0).
 *   O2 : 지정자 role 이 필드 의미와 어긋난 데이터는 '로그로만' 표면화(배정 변경 X).
 *
 * ⚠ 정본 AUTOASSIGN-BALANCE-TOSS 31 spec 은 별도 파일에서 그대로 PASS 유지되어야 한다.
 *   본 spec 은 그 위에 얹는 ADDITIVE 관찰/경고 레이어만 검증한다.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ENGINE = read('src/lib/autoAssign.ts');
const ENGINE_CODE = stripComments(ENGINE);
const BELL = read('src/components/AssignmentNotifyBell.tsx');
const BELL_CODE = stripComments(BELL);

// ── 감지·분류 (AC-1/AC-2) ──────────────────────────────────────────────────────
test.describe('감지·분류 — 지정자 fallback 사유', () => {
  test('fallback 사유 kind 는 not_in_working_ids | temp_off 두 축으로 구분', () => {
    expect(ENGINE_CODE).toMatch(
      /DesignatedFallbackKind\s*=\s*'not_in_working_ids'\s*\|\s*'temp_off'/,
    );
  });

  test('분류 규칙: 근무목록 미매칭 → not_in_working_ids, 그 외(임시off) → temp_off', () => {
    expect(ENGINE_CODE).toMatch(
      /!workingIds\.has\(designatedId\)\s*\?\s*'not_in_working_ids'\s*:\s*'temp_off'/,
    );
  });

  test('지정자 존재 + 0순위 미발동일 때만 fallback 감지(designatedId 가드)', () => {
    // 지정자 자체가 없으면(초진/미지정) fallback 감지 대상 아님.
    expect(ENGINE_CODE).toMatch(/if \(designatedId\) \{[\s\S]*?designatedFallback = \{ kind, staffName: dName \}/);
  });

  test('감지 시 서버 로그(console.warn)로 원인 남김 — 시트/이름표기 확인 문구 포함', () => {
    expect(ENGINE_CODE).toMatch(/designated fallback/);
    expect(ENGINE_CODE).toContain('구글시트 근무목록 미매칭');
  });
});

// ── reason 태그 기록 (AC-1) ────────────────────────────────────────────────────
test.describe('reason 태그 — assignment_actions 에 구조화 기록', () => {
  test('fallback 이면 buildDesignatedFallbackReason 로 reason 태그 기록', () => {
    // T-20260701-foot-REVISIT-CONSULT-ALERT-FULLSKIP: reason 결정이 순수 함수 resolveAssignReason(SSOT)로
    //   추출됨(삼항 → if 분기). fallback→태그 매핑 intent 는 그대로 보존(치료사 오인 민원 경고 유지).
    expect(ENGINE_CODE).toMatch(
      /if \(designatedFallback\) \{\s*return buildDesignatedFallbackReason\(designatedFallback\.kind, designatedFallback\.staffName\)/,
    );
  });

  test('build/parse 헬퍼가 designated_fallback 프리픽스로 왕복(round-trip) 가능', () => {
    expect(ENGINE_CODE).toContain("DESIGNATED_FALLBACK_PREFIX = 'designated_fallback'");
    expect(ENGINE_CODE).toMatch(/export function buildDesignatedFallbackReason/);
    expect(ENGINE_CODE).toMatch(/export function parseDesignatedFallbackReason/);
  });

  test('fallback reason 은 치료사(therapy) 경로에선 sentinel 과 상호배타 — 알림 suppress 안됨(SHEET-MATCH-GUARD 유지)', () => {
    // T-20260701-foot-REVISIT-CONSULT-ALERT-FULLSKIP (B→A supersede):
    //   ★재진 '상담(consult)' fallback 은 이제 sentinel(알림 완전 제외) — resolveAssignReason 최우선 분기.
    //   그러나 '치료사(therapy)' 및 비-재진 fallback 은 종전대로 fallback 태그(알림 노출) — SHEET-MATCH-GUARD 의도 보존.
    //   순수 함수 SSOT 구조로 검증: (1) consult+재진 → 최우선 sentinel, (2) 그 외 fallback → 태그, (3) 치료사 지정 sentinel 유지.
    expect(ENGINE_CODE).toMatch(/if \(role === 'consult' && isReturning\) return ASSIGN_SILENT_REASON/); // (1) B→A 상담 전 구간
    expect(ENGINE_CODE).toMatch(/if \(designatedFallback\) \{\s*return buildDesignatedFallbackReason/);   // (2) 치료사 등 fallback 태그(노출)
    expect(ENGINE_CODE).toMatch(/if \(usedDesignated && isReturning\) return ASSIGN_SILENT_REASON/);      // (3) 재진 치료사 지정 sentinel 유지
    // maybeAutoAssign 은 이 SSOT 를 그대로 사용(중복 로직 제거).
    expect(ENGINE_CODE).toMatch(/const reason = resolveAssignReason\(\{/);
  });
});

// ── 배정 로직 무변경 (AC-3) ────────────────────────────────────────────────────
test.describe('AC-3 — 정본 우선순위 로직 무변경(관찰 레이어만 추가)', () => {
  test('0순위 조건식 원형 보존 — designatedId && workingIds.has && !tempOff.has', () => {
    expect(ENGINE_CODE).toMatch(
      /if \(designatedId && workingIds\.has\(designatedId\) && !tempOff\.has\(designatedId\)\)/,
    );
  });

  test('fallback 분기는 여전히 pickLeastLoaded(pool, load, order) 로 균등배정(변경 없음)', () => {
    expect(ENGINE_CODE).toMatch(/chosen = pickLeastLoaded\(pool, load, order\)/);
  });

  test('감지 코드가 chosen(배정 결과)을 재지정하지 않음 — designatedFallback 은 관찰용 변수', () => {
    // designatedFallback 대입 라인은 chosen 을 건드리지 않는다(사유 기록만).
    expect(ENGINE_CODE).not.toMatch(/designatedFallback[\s\S]{0,40}chosen =/);
  });
});

// ── O2 role 정합 (로그 전용) ────────────────────────────────────────────────────
test.describe('O2 — 지정자 role 정합 어긋남은 로그로만 표면화(배정 변경 X)', () => {
  test('지정자 staff.role 이 기대 role 과 다르면 console.warn(O2 role mismatch)', () => {
    expect(ENGINE_CODE).toMatch(/O2 role mismatch/);
    expect(ENGINE_CODE).toMatch(/dStaff\.role !== expectedRole/);
  });

  test('O2 검사는 배정 로직에 개입하지 않음 — 로그 문구에 "배정 로직 무변경" 명시', () => {
    expect(ENGINE_CODE).toContain('데이터 정합 확인 필요(배정 로직 무변경)');
  });
});

// ── 운영자 힌트 노출 (AC-2) ────────────────────────────────────────────────────
test.describe('AC-2 — AssignmentNotifyBell 운영자 힌트', () => {
  test('reason 을 parseDesignatedFallbackReason 로 파싱해 fallback 필드로 매핑', () => {
    expect(BELL_CODE).toMatch(/fallback: parseDesignatedFallbackReason\(a\.reason\)/);
  });

  test('힌트 문구가 원인별로 구분 노출 — 시트 미매칭 vs 임시휴무', () => {
    expect(BELL_CODE).toContain('근무목록 미매칭');
    expect(BELL_CODE).toContain('근무캘린더·이름표기 확인');
    expect(BELL_CODE).toContain('임시휴무');
  });

  test('패널 항목에 fallback 힌트 testid 노출 + kind 데이터속성', () => {
    expect(BELL_CODE).toContain('data-testid="assign-notify-fallback-hint"');
    expect(BELL_CODE).toMatch(/data-fallback-kind=\{n\.fallback\.kind\}/);
  });

  test('비-fallback 항목 마키 라인 포맷 회귀0 — "고객 → 담당자 배정" 유지', () => {
    expect(BELL_CODE).toMatch(/\$\{n\.customerName\} → \$\{n\.staffName\} 배정/);
  });
});
