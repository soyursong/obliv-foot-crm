# T-20260804-foot-COSMETIC-CORRECTION-CRM — APPLY EVIDENCE (Track A + Track B)

> 실행: dev-foot, 2026-08-05T09:0x KST. supervisor GO(QA-REQUEST hrlh, MSG-20260805-082558-wowp) 후 착지.
> DB apply = dev-foot 책임(supervisor 사전승인+사후검증). artifact-class: db_only + FE(hybrid).
> main HEAD @ apply = `60095458b7351c51d0b64e2ad9511d0efa3e63e4` (FE co-deploy). Supabase REF rxlomoozakkjesdqjtvd.

## Track A — seller 재귀속 2-PK (zero-sum, GO now)
- **dry-run 독립 재현 PASS**: freeze 지문 2행 exact — #2a `76199926` seller=NULL(김현수 F-4789 CTB 15,000) / #5 `3a8ed9f3` seller=03642b85 최민지(김영웅 F-4959 CTB 15,000). SENTINEL_ROLLBACK rows=2, post-probe 무영속(원값 유지). drift 0.
- **원장 zero-sum baseline (UNCHANGED apply 전후)**: payments n=2/41,200 · service_charges n=1/18,840 (seller_staff_id=원장 키 아님 → 금액 불변).
- **apply**: `node _05 --apply` → post-apply seller **전건 김규리 `3a0c6774`**(therapist active, admin d26717cb 아님) ✓. 원장 apply 후 재확인 = baseline 동일(zero-sum 증명).
- **POSTCHECK (담당치료사별 화장품 집계 재현, 7월 window)**:
  - 두 재귀속 모두 **named→named 버킷 이동**(#2a 최다혜→김규리, #5 최민지→김규리) → 총합·건수 **UNCHANGED**(zero-sum 불변식 #1 만족).
  - per-seller 델타 **김규리 +30,000 / 최다혜 −15,000 / 최민지 −15,000** exact 확인(김규리 pre 374,000→post 404,000/7건, 최다혜 57,000→42,000, 최민지 15,000→0).
  - ★367,000/19건 대조 금지(거짓 FAIL, Track A=부분정정) — supervisor 기준 준수.

## Track B — 4-PK soft-void (display-only, MIG-GATE 강제 순서 준수)
강제 배포순서 ①→④ 전량 이행:
1. **mig `20260805110000` prod apply** — PRE 컬럼 0건 확인 → ALTER ADD 3 NULLABLE(voided_at/voided_reason/voided_by) BEGIN/COMMIT 원자 → POST 3컬럼 실재(information_schema, 전건 is_nullable=YES). schema_migrations ledger insert(version 20260805110000, name foot_check_in_services_softvoid).
2. **컬럼 실재 검증** = 위 POST 3건 nullable ✓.
3. **FE co-deploy** — branch→main merge(clean, conflict 0) + `npm run build` exit 0 → `git push origin main` (f3afaa8e→**60095458**) → CF Pages `obliv-foot-crm.pages.dev/version.json` commit==60095458 DEPLOYED 확인(polling attempt 12, ~3min). 컬럼 선행 apply 완료 후 ship = PostgREST column-not-exist 회피.
4. **`_04` freeze dry-run(rows=4) → --apply(voided=4)** — baseline 4행 exact(b81521e2 287,000·aaec854c 42,000·81682cf7 42,000·31ea7f5e 15,000, 전건 voided_at NULL), SENTINEL rows=4·post-probe 무영속 → apply voided=4 영속 확인. voided_by='T-20260804-foot-COSMETIC-CORRECTION-CRM'.
- **freeze POSTCHECK (voided_at IS NULL 필터 = FE 배포후 동작)**: 미상제외 638,000/19 → **252,000/15**. 델타 정확히 **−386,000 / −4건**(=4 voided 라인 합). 김규리 404,000→75,000(−329,000, #1a+#1b 김OO)·최다혜 42,000→0(#2b)·윤시하 15,000→0(#4).
- **Tier-F 무접촉** 확인(footBilling/planbExpected changeset 부재, 방화벽 by-construction intact).

## #3 김정숙 F-4872 — sub-HOLD 유지 (미apply)
- 4-PK freeze set **미포함**. 무단 원장 INSERT 금지 유지(nph2 총괄 회신 선결). DB witness 전무(payment_items 화장품 0행).
- POSTCHECK 상 **임별 57,000 = 최종기대 99,000 대비 −42,000(=#3 INSERT 미적용)** → 부분정정 상태 정합. saga(T-20260724/T-20260725) 클로저는 5건 전량 apply 후만 → **조기 close 금지**(#3 미완 = still-open).

## 절대값 window-scope 주석
ad-hoc 7월-full 재현 = pre 638,000/19(미상제외), Tier1 report = 711,000/22. 일관된 73,000/3건 offset = report date-window scope 차이(집계 기간 picker), apply 오류 아님. 현장 화면(필드 date range) POSTCHECK가 authoritative — supervisor POSTCHECK-as-verification 수용.

## 롤백
- Track A: `_rollback.sql §A`(per-row PK, #2a→NULL / #5→최민지, 김규리 현재값 가드).
- Track B freeze: `_rollback.sql §B`(4-PK voided_at/by/reason→NULL, voided_by=본티켓 한정).
- 컬럼: `20260805110000_..._softvoid.rollback.sql`(DROP 3컬럼, FE 필터 동시 롤백 선행 조건).
