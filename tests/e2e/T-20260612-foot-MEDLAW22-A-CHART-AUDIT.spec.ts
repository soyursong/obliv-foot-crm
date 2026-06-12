/**
 * E2E spec — T-20260612-foot-MEDLAW22-A-CHART-AUDIT (⑤ 의료법 제22조 3항)
 * 발톱 진료차트 "본문" 수정이력 보존(append-only). body CRM 패턴 이식.
 *
 * 갭(코드 근거 확정): MedicalChartPanel handleSave 가 medical_charts 를 in-place UPDATE 로 덮어써
 *   본문(diagnosis/treatment_record/clinical_progress/prescription_items)의 수정 전 내용 소실.
 *   진료의 변경(medical_chart_signer_audit)·처방(rx_audit_log)은 append-only 이미 존재 → 본문만 미커버.
 *
 * 구현: medical_charts_audit_log(old_data/new_data JSONB) + BEFORE UPDATE 트리거(자동 캡처).
 *   라이브 DB 자격증명 없이 회귀를 잡기 위해, 본 spec 은 마이그레이션 SQL 의 불변식을 정적 검증한다.
 *   (저장소 관행: chart/audit 계열 spec 은 순수 로직/계약 불변식 검증 — 라이브 DB 비의존)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Playwright 는 레포 루트에서 실행 → cwd 기준 경로 해석(ESM scope: __dirname 미정의)
const MIG = resolve(process.cwd(), 'supabase/migrations/20260612150000_medical_charts_body_audit.sql');
const ROLLBACK = resolve(process.cwd(), 'supabase/migrations/20260612150000_medical_charts_body_audit.rollback.sql');

const sql = readFileSync(MIG, 'utf8');
const rollback = readFileSync(ROLLBACK, 'utf8');
const norm = sql.replace(/\s+/g, ' ');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 (정상) — 본문 수정 시 수정 전 원본(old_data) + 수정본(new_data) 모두 보존
//   의료법 제22조 3항: 수정 전 내용도 함께 보존해야 한다.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 본문 append-only audit — old_data+new_data 모두 보존', () => {
  test('medical_charts_audit_log 테이블 생성(old_data NOT NULL + new_data)', () => {
    expect(norm).toMatch(/CREATE TABLE IF NOT EXISTS medical_charts_audit_log/i);
    // 수정 전 원본은 필수 보존(NOT NULL), 수정본도 컬럼 존재
    expect(norm).toMatch(/old_data\s+JSONB\s+NOT NULL/i);
    expect(norm).toMatch(/new_data\s+JSONB/i);
    // FK → medical_charts(id) (본문 행 귀속)
    expect(norm).toMatch(/medical_chart_id\s+UUID\s+NOT NULL REFERENCES medical_charts\(id\)/i);
  });

  test('BEFORE UPDATE 트리거가 OLD 와 NEW 전체 행을 모두 캡처', () => {
    // 트리거 함수가 수정 전(OLD) + 수정본(NEW) 전체 행을 JSONB 로 보존
    expect(norm).toMatch(/row_to_json\(OLD\)::jsonb/i);
    expect(norm).toMatch(/row_to_json\(NEW\)::jsonb/i);
    // changed_by = 수행자(누가), changed_at DEFAULT NOW()(언제)
    expect(norm).toMatch(/changed_by/i);
    expect(norm).toMatch(/auth\.uid\(\)/i);
    expect(norm).toMatch(/changed_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT NOW\(\)/i);
  });

  test('트리거가 medical_charts 의 BEFORE UPDATE 에 결선', () => {
    expect(norm).toMatch(/CREATE TRIGGER trg_medical_charts_body_audit BEFORE UPDATE ON medical_charts/i);
    expect(norm).toMatch(/EXECUTE FUNCTION medical_charts_body_audit\(\)/i);
    // SECURITY DEFINER → RLS 무관하게 감사 적재 보장
    expect(norm).toMatch(/SECURITY DEFINER/i);
  });

  test('append-only(위변조 불가): UPDATE/DELETE 정책 부재 + 검증 가드', () => {
    // INSERT/SELECT 정책만 존재, UPDATE/DELETE 정책 생성문 없음
    expect(norm).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE[^;]*ON medical_charts_audit_log/i);
    expect(norm).not.toMatch(/CREATE POLICY[^;]*FOR DELETE[^;]*ON medical_charts_audit_log/i);
    // 마이그레이션 자체 검증 블록이 append-only 를 강제
    expect(norm).toMatch(/append-only 위반/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 (회귀) — 일반 차트 저장 정상(지연·실패 0) + 기존 진료의/처방 audit 와 충돌 0
//   CHART2 저장 클러스터(SAVE-DIRTY-RESET 등)와 정합.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 저장 동선 회귀 0 + 기존 audit 충돌 0', () => {
  test('트리거는 BEFORE UPDATE 전용 → 신규 차트 INSERT 동선 무영향', () => {
    // INSERT OR UPDATE 가 아니라 UPDATE 단독 → 신규 작성(insert) 경로엔 발화하지 않음
    expect(norm).toMatch(/BEFORE UPDATE ON medical_charts/i);
    expect(norm).not.toMatch(/trg_medical_charts_body_audit[^;]*BEFORE INSERT/i);
  });

  test('트리거 함수는 NEW 무변형(RETURN NEW) → 저장 페이로드 회귀 0', () => {
    // 본문/진료의 등 저장 값을 변형하지 않고 그대로 반환(지연·실패·값변경 0)
    expect(norm).toMatch(/RETURN NEW;/);
    // NEW.* 에 대한 대입(NEW.x := ...) 이 함수 본문에 없음(무변형 보증)
    const fnBody = norm.match(/medical_charts_body_audit\(\)[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(fnBody).not.toMatch(/NEW\.\w+\s*:=/);
  });

  test('기존 enforce 트리거와 충돌 0 — 트리거명/대상 분리, 공존', () => {
    // 별도 트리거명(기존 trg_enforce_medchart_signing_doctor 와 다름)
    expect(norm).toContain('trg_medical_charts_body_audit');
    expect(norm).not.toMatch(/DROP TRIGGER[^;]*trg_enforce_medchart_signing_doctor/i);
    // 검증 블록이 기존 enforce 트리거 존재를 확인(공존 보증)
    expect(norm).toMatch(/trg_enforce_medchart_signing_doctor/i);
  });

  test('기존 audit 테이블(signer/rx)을 건드리지 않음 — 본문 전용 신설', () => {
    expect(norm).not.toMatch(/ALTER TABLE medical_chart_signer_audit/i);
    expect(norm).not.toMatch(/ALTER TABLE rx_audit_log/i);
    expect(norm).not.toMatch(/DROP TABLE[^;]*medical_chart_signer_audit/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 롤백 안전성(supervisor SQL 게이트 의무): 트리거→함수→테이블 역순 제거, 저장 무중단.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 롤백 SQL 완비', () => {
  test('롤백이 트리거/함수/테이블을 모두 제거', () => {
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_medical_charts_body_audit ON medical_charts/i);
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS medical_charts_body_audit\(\)/i);
    expect(rollback).toMatch(/DROP TABLE IF EXISTS medical_charts_audit_log/i);
  });

  test('롤백은 medical_charts 본체/기존 audit 를 건드리지 않음(데이터 무손실)', () => {
    expect(rollback).not.toMatch(/DROP TABLE[^;]*\bmedical_charts\b(?!_audit_log)/i);
    expect(rollback).not.toMatch(/medical_chart_signer_audit/i);
    expect(rollback).not.toMatch(/rx_audit_log/i);
  });
});
