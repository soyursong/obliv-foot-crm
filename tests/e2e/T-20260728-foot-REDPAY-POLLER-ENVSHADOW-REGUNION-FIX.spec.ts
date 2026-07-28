/**
 * Regression spec — T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX
 * 레드페이 폴러 resolveWhitelists() env-shadow RC 근본봉인 (236-FALSENEG spinoff).
 *
 * e2e_spec_exempt_reason: ef_only (폴러=macstudio launchd, CRM UI 무변경) — 아래는 정적
 *   소스 불변식 회귀 가드 + 런타임 검증 위임. 런타임 로직 검증 주체는
 *   `node scripts/redpay_macstudio_poller.mjs --self-test`(union 5-case + foot-scope 보존).
 *   본 스펙은 union 배선이 원복(env-shadow early-return 재유입)되지 않도록 파일-레벨 불변식을 고정한다.
 *
 * RC: 구 resolveWhitelists()는 env override(merchant+tid 양쪽)가 있으면 DB registry(SSOT)를
 *     완전 shadow(early-return) → env stale 시 registry 등록 TID(538 band) 미로드 → drift 오탐.
 *
 * 불변식:
 *  I1. 순수 union 함수 resolveWhitelistSources() 존재(self-test 대상화).
 *  I2. env-shadow early-return(`if (envMerchant && envTid) { ...; return; }`) 제거 확인.
 *  I3. TID = env ∪ registry union 배선 존재. merchant = admit 권위(env 우선 무변경).
 *  I4. reg=null fail-safe(default) 분기 유지.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const POLLER = 'scripts/redpay_macstudio_poller.mjs';

test.describe('T-20260728 REDPAY poller env∪registry union', () => {
  const src = fs.readFileSync(POLLER, 'utf-8');

  test('I1. 순수 union 함수 resolveWhitelistSources() 존재', () => {
    expect(src).toContain('function resolveWhitelistSources(');
    expect(src).toContain('async function resolveWhitelists()');
    expect(src).toContain('await resolveWhitelists()');
  });

  test('I2. env-shadow early-return 제거 (registry 항상 조회)', () => {
    // 구 RC 패턴이 되살아나면 실패시킨다.
    expect(src).not.toMatch(/if\s*\(\s*envMerchant\s*&&\s*envTid\s*\)\s*\{[^}]*return;/s);
    // resolveWhitelists 는 무조건 loadRegistryFromDb 를 await 해야 함(TID union 위함).
    const body = src.slice(src.indexOf('async function resolveWhitelists()'));
    expect(body).toContain('const reg = await loadRegistryFromDb();');
  });

  test('I3. TID = env ∪ registry UNION, merchant = admit 권위(env 우선 무변경)', () => {
    // TID union 배선: envTid ? [...new Set([...reg.tids, ...baseTidList])] : reg.tids
    expect(src).toContain('new Set([...reg.tids, ...baseTidList])');
    // merchant 는 union 미적용(admit surface 불변) — env 우선, 없으면 registry
    expect(src).toContain('envMerchant ? baseMerchantList.slice() : reg.merchants.slice()');
  });

  test('I4. reg=null fail-safe(default) 분기 유지 (정전/네트워크 생존)', () => {
    expect(src).toContain('if (!reg)');
    expect(src).toContain('source: "default"');
    expect(src).toContain('source: "registry"');
  });
});
