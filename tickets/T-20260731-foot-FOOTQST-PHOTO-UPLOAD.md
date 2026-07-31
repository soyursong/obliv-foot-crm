---
id: T-20260731-foot-FOOTQST-PHOTO-UPLOAD
title: "발건강질문지 고객 사진 첨부 (발/발톱 사진 업로드)"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-07-31
deploy_ready: true
deploy_ready_at: 2026-07-31T15:20:00+09:00
deploy_ready_by: dev-foot
db_migration: true
build_passed: true
commit_sha: PENDING_PUSH
e2e_spec: tests/e2e/T-20260731-foot-FOOTQST-PHOTO-UPLOAD.spec.ts
signals_recorded: true
da_consult: MSG-20260731-135832-y3x7
da_consult_ssot: da_consult_reply_foot_footqst_photo_upload_20260731.md
medical_confirm_gate: not_required
self_deploy: forbidden
---

## 개요

발건강질문지(/health-q/:token) 고객 자가작성 중 **발/발톱 사진 첨부** 기능. 고객이 고민되는 부위를
직접 촬영해 첨부 → 직원 차트(HealthQResultsPanel)에서 signed URL 로 조회.

## 정본 근거 (§S2.4 데이터 정책 게이트)

- data-architect CONSULT-REPLY **MSG-20260731-135832-y3x7** (GO + ADDITIVE 조건부).
  - SSOT = `da_consult_reply_foot_footqst_photo_upload_20260731.md`.
  - 대표 게이트 EXEMPT (§3.1, 파괴적 DDL 무·계약 무저촉). supervisor DDL-diff 게이트만.

## 구현 (Pattern B — anon 은 Storage/PHI 직접 무접촉)

1. **마이그레이션** `20260731150000_foot_healthq_photo_upload.sql` (+rollback +dryrun)
   - ① 신규 전용 private 버킷 `foot-health-q-photos` (public=false). documents 재사용 REJECT.
   - ② anon storage.objects INSERT 정책 부재 → 업로드는 service_role signed URL 만.
   - ③ 제출 RPC `fn_health_q_submit`(+p_photos) 가 경로 prefix `health-q/{clinic_id}/{token}/` 재검증.
   - ④ 직원 SELECT = clinic 스코프 (테이블 RLS + storage.objects SELECT 미러).
   - ⑤ `health_q_photos` 1:N (result_id → health_q_results ON DELETE CASCADE, clinic_id denorm).
        jsonb photo_paths REJECT. storage DELETE 정책 미부여(archive-first).
2. **Edge Function** `health-q-photo-sign` (verify_jwt=false) — token 검증 후 token-경로 한정 signed upload URL 발급.
3. **모바일** `HealthQMobilePage` — 사진 picker(태블릿 큰 버튼: 카메라/앨범) → uploadToSignedUrl → 제출 시 p_photos 전달.
4. **직원 뷰** `HealthQResultsPanel` ResultCard — 첨부사진 썸네일(30분 TTL signed download, clinic 스코프).

## 검증

- `npm run build` OK. `deno check` (edge fn) OK.
- E2E `T-20260731-foot-FOOTQST-PHOTO-UPLOAD.spec.ts` 5 PASS (functional 업로드 + DA 5조건 static 회귀가드).
- 회귀 health-q 20 PASS (SELF-RESTRUCTURE / FOOTQ-VIEWER / SELF-ADD-2Q).

## supervisor 게이트 (DDL-diff 강제 5항)

① 버킷 private ② anon Storage 직접 INSERT GRANT 부재(signed-URL/RPC only) ③ anon-write RLS token 경로 한정
④ 직원 SELECT clinic 스코프 ⑤ CASCADE + clinic_id denorm.

→ supervisor: DDL-diff 게이트 → prod 마이그 적용 → `supabase functions deploy health-q-photo-sign` → main merge → CF Pages 자동배포(FE).

## follow-up (비블로커, planner)

- Storage-orphan TTL sweep 잡 (draft 미제출 = health_q_tokens.expires_at 기준).
- 보존정책 codify (health_q_results 상속).
- cross_crm_data_contract PHI-image storage § codify.
