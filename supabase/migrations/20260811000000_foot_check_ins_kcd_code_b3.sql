-- T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — up (상병 청구 연결: 스태프 캡처 컬럼 신설)
--
-- 문제: insurance_claim_diagnoses = 0건. 발톱은 급여 상병(KCD)을 청구에 실을 캡처면이 사실상 부재
--   (차트 49건 中 KCD 4건). 유일한 상병 입력면 = DiagnosisFolderPicker → medical_charts.diagnosis
--   = 의사 진료차트(§11 medical_confirm_gate) 종속 → 의사 차트가 없으면 급여방문 상병 미포착.
--   건보 명세는 방문당 상병 1건 이상 필수 → 스태프(비의사) 캡처 경로가 필요.
--
-- 최소변경: 동일 요양기관(13328581) body(도수) 패턴 이식 — check_ins.kcd_code 단일 컬럼.
--   ref: obliv-body-crm/supabase/migrations/20260515000010_kcd_codes.sql (check_ins.kcd_code TEXT)
--
--   ★ foot 고유 발산(body와 다른 점): body는 kcd_codes 마스터 테이블을 함께 두지만, foot 은
--     KCD 소스를 정적 번들(src/lib/kcd/kcdData.ts, T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN,
--     "DB 무변경" AC-0)로 확정했다 → foot 은 kcd_codes 마스터를 신설하지 않는다(최소 표면).
--     따라서 본 마이그레이션의 신규 스키마 = check_ins.kcd_code 단 1컬럼.
--
--   ★ KCD 발명 금지: 컬럼은 저장소일 뿐. FE 는 foot 정적 KCD 번들(isKnownKcdCode)에서 스태프가
--     '선택'한 값만 기록한다(자동 추론/발명 금지). 미입력 → 상병 결핍 표식(FE deficiency marker).
--
-- 런타임 통합(claim 생성 시 check_ins.kcd_code → insurance_claim_diagnoses 복사)은 B-2(청구 명세
--   자동생성)가 claim 을 생성하는 것을 전제로 한다 → 본 티켓 병렬 착수, 런타임 join 은 B-2 이후.
--
-- change_class = ADDITIVE (신규 컬럼 1 · nullable · DEFAULT 없음 · backfill 0 · 기존행 무변경 ·
--   DROP 0 · txn-control(BEGIN/COMMIT) 없음). §S2.4 DA CONSULT(스키마 게이트) 대상 → DA GO 선행 필수.
--   ADDITIVE + DA GO 시 §3.1 대표(파괴) 게이트 면제 후보. 적용 게이트 = supervisor DB-GATE GO-token.
--
-- ⚠️ 본 파일은 PROD 미적용 상태로 스테이징된다. DA CONSULT GO + supervisor DDL-diff + GO-token
--    발행 전 prod DDL apply 금지(apply_before_go 클래스). db_apply_guard.sh lane 경유.
--
-- dry-run  : 20260811000000_foot_check_ins_kcd_code_b3.dryrun.sql
-- rollback : 20260811000000_foot_check_ins_kcd_code_b3.rollback.sql

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS kcd_code TEXT;

COMMENT ON COLUMN public.check_ins.kcd_code IS
  'KCD 상병코드 (예: M72.2 족저근막염) — 스태프가 정적 KCD 번들에서 선택 시 저장. 건보 청구 상병 캡처 원천(방문 단위). B-2 claim 생성 시 insurance_claim_diagnoses 로 복사. (T-20260810-foot-INS-CLAIM-DIAGLINK / body 20260515000010 패턴 이식, kcd_codes 마스터 미신설=foot 정적번들 lockdown)';
