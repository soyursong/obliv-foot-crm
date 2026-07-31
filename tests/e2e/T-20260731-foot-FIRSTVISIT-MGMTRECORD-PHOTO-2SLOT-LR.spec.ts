/**
 * E2E spec — T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT-LR
 * 초진 관리기록지 작성 화면 발 사진 2슬롯(오른발=R / 왼발=L) — treatment_photos 재사용.
 *
 * ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-175752-j08x (Option A GO / Option B REJECT).
 *   저장 = canonical treatment_photos 재사용(신규 테이블 금지). 진짜 부모 grain = check_in.
 *   판별자 source='first_visit_mgmt_record' + foot_side(오른발=R/왼발=L, 대문자 canonical, swap 금지).
 *   foot_side ADDITIVE(nullable+CHECK L/R) = health_q_photos.foot_side 와 동일 계약(laterality 2번째 인스턴스).
 *   partial unique 키에 source 필수(형제폼 격리). 버킷/RLS/CASCADE 전부 상속(신설 0).
 *
 * 이 서류(초진 관리기록지)는 인증 직원이 진료차트 → 서류 출력 다이얼로그에서 작성한다(anon 아님).
 * 슬롯 UI·저장·재조회는 DocumentPrintPanel 깊숙한 인증 플로우 안에 있어 정적 회귀(불변식) 검증으로 AC 전항 커버.
 * (마이그 ADDITIVE 불변식 + FE R/L pin + treatment_photos 재사용 + 패널 배선 + 재조회 필터)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = 'supabase/migrations/20260731210000_foot_treatment_photos_firstvisit_2slot.sql';
const RB = 'supabase/migrations/20260731210000_foot_treatment_photos_firstvisit_2slot.rollback.sql';
const COMP = 'src/components/FirstVisitFootPhotoSlots.tsx';
const PANEL = 'src/components/DocumentPrintPanel.tsx';

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), 'utf8');
}

test.describe('T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT-LR', () => {
  test('시나리오A: 마이그 — foot_side ADDITIVE(nullable+CHECK L/R) + source CHECK 확장 + partial unique(source 포함)', () => {
    const mig = read(MIG);
    // foot_side ADD COLUMN nullable + CHECK L/R (대문자 canonical)
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS foot_side TEXT NULL/);
    expect(mig).toMatch(/CHECK \(foot_side IS NULL OR foot_side IN \('L','R'\)\)/);
    // source CHECK 값집합 ADDITIVE 확장 — 기존 4값 전부 유지 + 신규값 (회귀0)
    expect(mig).toMatch(/'staff_capture','patient_upload','import','legacy_string_array','first_visit_mgmt_record'/);
    // partial unique — 키에 source 필수(형제폼 격리) + foot_side NOT NULL + deleted_at IS NULL
    expect(mig).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_treatment_photos_checkin_source_side[\s\S]*\(check_in_id, source, foot_side\)[\s\S]*WHERE foot_side IS NOT NULL AND deleted_at IS NULL/,
    );
    // 파괴적 DDL 부재 (기존 컬럼/테이블 DROP·RENAME 없음 — 회귀0)
    expect(mig).not.toMatch(/DROP COLUMN/);
    expect(mig).not.toMatch(/DROP TABLE/);
    expect(mig).not.toMatch(/CREATE TABLE/); // 신규 테이블 금지(Option B REJECT)
    // 버킷/RLS/CASCADE 무변 — 신규 버킷/정책 생성 없음(상속)
    expect(mig).not.toMatch(/storage\.buckets/);
    expect(mig).not.toMatch(/CREATE POLICY/);

    // 롤백 = 역연산(index DROP + column DROP + source CHECK 원복)
    const rb = read(RB);
    expect(rb).toMatch(/DROP INDEX IF EXISTS public\.uq_treatment_photos_checkin_source_side/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS foot_side/);
    expect(rb).toMatch(/'staff_capture','patient_upload','import','legacy_string_array'\)/);
  });

  test('시나리오B: FE 컴포넌트 — R/L pin, treatment_photos 재사용, source 판별자, foot_side 저장', () => {
    const c = read(COMP);
    // FOOT_SLOTS 상수: 오른발=R, 왼발=L (swap 금지, 대문자 canonical)
    expect(c).toMatch(/side:\s*'R',\s*ko:\s*'오른발'/);
    expect(c).toMatch(/side:\s*'L',\s*ko:\s*'왼발'/);
    // 저장 = canonical treatment_photos 재사용 + private 버킷 (신규 테이블 아님)
    expect(c).toMatch(/const BUCKET = 'treatment-photos'/);
    expect(c).toMatch(/const SOURCE = 'first_visit_mgmt_record'/);
    expect(c).toMatch(/\.from\('treatment_photos'\)\.insert\(/);
    // insert payload 에 source 판별자 + foot_side(laterality) + check_in 결속
    expect(c).toMatch(/source:\s*SOURCE/);
    expect(c).toMatch(/foot_side:\s*side/);
    expect(c).toMatch(/check_in_id:\s*checkInId/);
    // 재조회(AC#4) = check_in_id + source + deleted_at IS NULL 필터
    expect(c).toMatch(/\.eq\('check_in_id', checkInId\)/);
    expect(c).toMatch(/\.eq\('source', SOURCE\)/);
    expect(c).toMatch(/\.is\('deleted_at', null\)/);
    // 삭제 = soft-delete(의료법 §22) — 물리 storage.remove 는 미확정 신규 object 롤백 경로에만
    expect(c).toMatch(/update\(\{ deleted_at:/);
    // 서빙 = private 버킷 signed URL (public URL 금지)
    expect(c).toMatch(/createSignedUrl/);
    expect(c).not.toMatch(/getPublicUrl/);
  });

  test('시나리오C: DocumentPrintPanel 배선 — first_visit_mgmt_record 게이트 + checkIn 결속 전달', () => {
    const p = read(PANEL);
    // 컴포넌트 import
    expect(p).toMatch(/import \{ FirstVisitFootPhotoSlots \} from '@\/components\/FirstVisitFootPhotoSlots'/);
    // form_key 게이트(초진 관리기록지 전용 격리) + null 가드
    expect(p).toMatch(
      /template\.form_key === 'first_visit_mgmt_record' && checkIn\.customer_id && checkIn\.clinic_id/,
    );
    // check_in 결속 값 전달(진짜 부모 grain)
    expect(p).toMatch(/checkInId=\{checkIn\.id\}/);
    expect(p).toMatch(/customerId=\{checkIn\.customer_id\}/);
    expect(p).toMatch(/clinicId=\{checkIn\.clinic_id\}/);
  });

  test('시나리오D: 슬롯 라벨/testid 노출 — 오른발/왼발 각 1칸 (AC#1)', () => {
    const c = read(COMP);
    // 두 슬롯 testid (R/L)
    expect(c).toMatch(/fvmr-foot-slot-\$\{slot\.side\}/);
    expect(c).toMatch(/fvmr-foot-photo-section/);
    // 파일 형식/용량 가드 (AC#5)
    expect(c).toMatch(/type\.startsWith\('image\/'\)/);
    expect(c).toMatch(/MAX_BYTES/);
    // 이미지 accept
    expect(c).toMatch(/accept="image\/\*"/);
  });
});
