-- T-20260606-foot-RX-SET-REDESIGN AC-R1: 약품 폴더 트리 (개별 약품 분류)
-- 요청: 문지은 대표원장 (C0ATE5P6JTH, MSG-20260606-103639-rato 설계 확정)
-- rollback: see 20260607180000_prescription_drug_folders.rollback.sql
--
-- ── 현장 용어 ↔ 코드 식별자 SSOT (AC-R6) ──────────────────────────────────────────
--   현장 "처방세트" = 전체 약 카탈로그          ← 코드 prescription_codes (무변경)
--   현장 "폴더"      = 약 분류/탐색 도구(어드민)  ← 본 마이그 신설 prescription_folders
--   현장 "묶음처방"  = 빠른처방 프리셋(이름+약)    ← 코드 prescription_sets (무변경)
--
-- ⚠️ ADDITIVE ONLY — 기존 prescription_codes 컬럼/검색쿼리/스냅샷 전부 무변경.
--    폴더 분류는 prescription_codes 를 건드리지 않고 별도 매핑테이블로만 표현한다.
--    (risk_reason: "폴더 신설이 검색쿼리/스냅샷에 미치는 영향" → 카탈로그 무변경으로 원천 차단)
--
-- supervisor SQL 게이트 대상(dry-run + 롤백 확인 후 prod 적용). dev-foot prod 직접실행 금지.

-- ── 1. 약품 폴더 (자기참조 다단계 트리) ───────────────────────────────────────────
--  parent_id NULL = 루트 폴더. ON DELETE CASCADE = 부모 폴더 삭제 시 하위 폴더 연쇄 삭제.
CREATE TABLE IF NOT EXISTS prescription_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES prescription_folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_folders_parent
  ON prescription_folders(parent_id);

COMMENT ON TABLE prescription_folders IS
  'T-20260606-foot-RX-SET-REDESIGN 약품 폴더 트리(자기참조 다단계). 현장용어 "폴더". 어드민 관리.';

-- ── 2. 약품 → 폴더 매핑 (move 시맨틱: 약 1건 = 폴더 0~1개) ─────────────────────────
--  PRIMARY KEY(prescription_code_id) 로 "약 하나는 폴더 하나"를 강제(파일 탐색기 이동 시맨틱).
--  ON DELETE CASCADE(약품/폴더 양쪽) = 약 또는 폴더 삭제 시 매핑 자동 정리.
--  → 폴더 삭제 시 약품 자체는 보존되고 미분류로 환원(매핑행만 삭제).
CREATE TABLE IF NOT EXISTS prescription_code_folders (
  prescription_code_id UUID PRIMARY KEY REFERENCES prescription_codes(id) ON DELETE CASCADE,
  folder_id            UUID NOT NULL REFERENCES prescription_folders(id) ON DELETE CASCADE,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_code_folders_folder
  ON prescription_code_folders(folder_id);

COMMENT ON TABLE prescription_code_folders IS
  'T-20260606-foot-RX-SET-REDESIGN 약품↔폴더 매핑(PK=code_id → 약 1건당 폴더 1개). 미분류=행 없음.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
--  읽기: 인증사용자 전원(진료차트 탐색기 트리 렌더).
--  쓰기: 인증사용자 허용 + 앱레이어 admin/관리권한 role gate(PrescriptionSetsTab 패턴과 동일).
--        RLS 컬럼제약 한계상 prescription_codes 카탈로그 자체는 read-only 유지(여기서 안 건드림).
ALTER TABLE prescription_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prescription_folders_read_all"
  ON prescription_folders FOR SELECT TO authenticated USING (true);
CREATE POLICY "prescription_folders_write_auth"
  ON prescription_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE prescription_code_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prescription_code_folders_read_all"
  ON prescription_code_folders FOR SELECT TO authenticated USING (true);
CREATE POLICY "prescription_code_folders_write_auth"
  ON prescription_code_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 재실행 안전: CREATE TABLE/INDEX IF NOT EXISTS. (정책은 rollback 후 재적용)
