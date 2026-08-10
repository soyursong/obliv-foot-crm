-- T-20260810-foot-INS-HIRACODE-SEED (B-1) — up (급여 수가코드 시드)
--
-- 발톱(foot) services.hira_code = 실제 청구 발생 급여 5종 전부 NULL → 건강보험 명세 성립 불가.
-- 본 마이그레이션은 접지(grounding)된 4종의 hira_code 만 시드한다. KOH도말(조갑조직)은 미접지 → BLOCK(제외).
--
-- ★코드값 발명 절대 금지 — 각 코드는 심평원 실조회 OR 동일 요양기관(13328581) body/scalp2 기시드값 대조로만 접지.
--   접지 근거 (서비스명 → hira_code → 접지출처 → 점수대조):
--   1) 초진진찰료-의원        → AA154  → body services(AA154, consultation, score 197.12) 정확일치 · scalp2(AA154, 197.07)
--      foot 대상행 hira_score 197.12 == body 197.12  ✅
--   2) 재진진찰료-의원        → AA254  → body(AA254, 139.85) + scalp2(AA254, 139.85) 정확일치
--      foot 대상행 hira_score 139.85 == 139.85  ✅
--   3) 재진-물리치료,주사 등   → AA222  → body(AA222, consultation, score 49.09) 정확일치 (물리치료 재진 진찰료 감산코드)
--      foot 대상행 hira_score 49.09 == body 49.09  ✅
--   4) 단순처치 [1일]         → M0111  → 심평원 실조회: 단순처치[1일당], 상대가치 75.51, 급여 (medinavi/심평원 심사지침)
--      foot 대상행 hira_score 75.51 == 심평원 75.51  ✅
--
--   ★BLOCK (미접지 — 본 마이그레이션 제외):
--   5) 일반진균검사-KOH도말-조갑조직 (service_code D620300HZ, hira_score 110.2)
--      - 심평원 web 실조회 불가(medinavi 호스트 접속거부 · 검색 미노출)
--      - 동일 요양기관 sibling 부재: body KOH = D7020(28.5), foot 기시드 KOH = D6591(28.5) → 모두 '일반 균검사'로
--        본 대상(조갑조직 도말, 110.2)과 다른 검사/다른 점수 → 접지 불가. sibling 코드 복사 = 오매핑(발명) 금지.
--      - under-claim 안전원칙(plan §5): 불확실하면 청구 안 하는 쪽. 접지 확보 후 별도 티켓에서 시드.
--
-- change_class = DATA-ONLY (DDL 0 · 순수 DML UPDATE · 기존 컬럼 hira_code 값-채움 · BEGIN/COMMIT/txn-control 없음).
--   신규 컬럼/테이블/enum 0 → §S2.4 DA CONSULT(스키마 게이트) 대상 아님. 적용 게이트 = supervisor DB-GATE GO-token.
-- 멱등/안전: WHERE id=<uuid> AND service_code=<code> AND hira_code IS NULL (belt-and-suspenders).
--   재실행 시 0행(이미 채워진 값 무클로버) · service_code 불일치 시 무변경 · 매출/payments/service_charges 무접촉.
-- 대상 freeze-set (prod rxlomoozakkjesdqjtvd, 2026-08-10 조회):

UPDATE public.services SET hira_code = 'AA154'
  WHERE id = 'de611ed5-154a-475d-9eb3-19d6d3bad881' AND service_code = 'AA154' AND hira_code IS NULL;   -- 초진진찰료-의원

UPDATE public.services SET hira_code = 'AA254'
  WHERE id = '117befad-e8f8-48c6-b496-89c37a68a441' AND service_code = 'AA254' AND hira_code IS NULL;   -- 재진진찰료-의원

UPDATE public.services SET hira_code = 'AA222'
  WHERE id = '1a82c70a-07fe-4321-be44-8a206e3d1aa0' AND service_code = 'AA222' AND hira_code IS NULL;   -- 재진-물리치료,주사 등(물리치료 재진)

UPDATE public.services SET hira_code = 'M0111'
  WHERE id = '03189fa2-0536-4676-bc5d-ad5283a48a0c' AND service_code = 'M0111' AND hira_code IS NULL;   -- 단순처치 [1일]
