-- T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C) — prescription_codes 약별 '설명' 컬럼
-- planner NEW-TASK MSG-20260618-122929-darl (reporter 문지은 대표원장, #foot C0ATE5P6JTH)
-- rollback : 20260618130000_prescription_codes_description.rollback.sql
--
-- 목적(Part C):
--   처방세트 '전체보기' 테이블(DrugFoldersTab)에서 약별 자유텍스트 '설명'을 더블클릭 인라인 입력·저장.
--   저장된 설명은 진료차트 처방약 선택 패널(DrugFolderTree, Part D) + 처방내역 테이블(Part E) hover 툴팁의
--   SSOT(약 정보)로 표시된다.
--
-- ⚠️ ADDITIVE ONLY — prescription_codes 에 nullable text 컬럼 1개 추가. 기존 데이터/경로 무변경·무손실.
--   · description : 약별 자유텍스트 메모. 기본 NULL(미설정). CHECK 제약 없음(자유텍스트).
--       └ 처방 게이트·판정에 미관여(메모성). 공식문서/처방전 출력에는 미노출(표시처=관리·차트 hover 限).
--
-- write 경로: prescription_codes write = prescription_codes_admin_all RLS(is_admin_or_manager: admin/manager/director).
--   해당 정책은 T-20260617-foot-RXCODES-WRITE-RLS-CANONICAL(commit f22d8b1b, 영속검증 5/5 PASS) 로 이미 라이브.
--   → 본 컬럼 UPDATE(설명 저장)는 admin/manager 게이트(UI canEdit) + RLS 이중 가드로 정상 동작.
--
-- 데이터 정책(§S2.4): 신규 컬럼 1개 ADDITIVE → data-architect CONSULT + supervisor DDL-diff 게이트.
--   ADDITIVE 이므로 대표 게이트 면제(autonomy §3.1). READ(prescription_codes_read_all SELECT true) 미접촉.
--
-- 운영 적용: dev DB(rxlomoozakkjesdqjtvd)는 dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행').
--   prod 적용은 supervisor DDL-diff 게이트 후. FE는 deploy-tolerant(컬럼 미적용 시 description=undefined→툴팁 약정보 폴백, 저장은 RLS/컬럼 부재 시 에러 토스트).
--
-- dry-run 검증(적용 전 컬럼 부재 확인):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='prescription_codes' AND column_name='description';
--   -- 0 rows 기대

ALTER TABLE public.prescription_codes
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.prescription_codes.description IS
  'T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN(Part C) 약별 자유텍스트 설명(메모). '
  'NULL=미설정. 처방 게이트/판정 미관여(메모성). 표시처=처방세트 전체보기 관리 + 진료차트 처방약 선택/처방내역 hover 툴팁(Part D/E) SSOT. '
  '공식문서/처방전 출력 미노출.';
