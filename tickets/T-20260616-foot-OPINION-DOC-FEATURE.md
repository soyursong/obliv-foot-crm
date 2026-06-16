---
id: T-20260616-foot-OPINION-DOC-FEATURE
title: "[소견서] 균검사지 옆 신규 기능 — 발행(immutable 의무기록) + 서류 출력 (Phase 2, form 스택 재사용)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: true
spec-added: true
spec-exempt: false
rollback-sql: supabase/migrations/20260616160000_opinion_doc_form_stack.rollback.sql
commit_sha: 28553a33
created: 2026-06-16
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260616-143141-u7pu
risk_verdict: GO_WARN
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1781491923.605529"
da_consult_ref: MSG-20260616-151210-xxy7
da_proposal_msg: MSG-20260616-150605-4q49
phase: 2
prod_apply_gate: supervisor-ddl-diff-GO
---

# T-20260616-foot-OPINION-DOC-FEATURE — 소견서 신규 기능 (Phase 1 scaffold → Phase 2 form 스택 발행)

## 원 요청
김주연 총괄 (#foot thread 1781491923.605529). UI ref = 첨부 F0BAETELCTF(소견서 팝업: 진단서/금기증 옵션 그리드).

## DB 게이트
신규 테이블(템플릿+발행본) 동반 → data-architect CONSULT(MSG-20260616-141830-o298) 진행 중.
**Phase 1 = 영속 ZERO.** DB 마이그/wiring 은 DA CONSULT-REPLY GO 전까지 금지(준수). AC-5 데이터 모양 '제안'만 DA 스레드에 발행(MSG-20260616-150605-4q49).

## Phase 1 구현 (이번 배포 — commit 871309e8)
- **AC-1** 균검사지 '옆'에 [소견서] 탭 신설(`DoctorTools.tsx`). 균검사지 탭/섹션 내부 NOTOUCH(KOH in-flight 무회귀).
- **AC-2** 금일 내방객(check_ins 당일 KST, cancelled 제외) read-only 리스트업(`OpinionDocTab.tsx`).
- **AC-3** 고객 클릭 → 팝업(F0BAETELCTF 옵션 그리드: 진단서/금기증). 옵션 클릭 → 템플릿 문구 editor 자동삽입(toggle on/off, 줄 단위).
- **AC-4** 자동삽입 최종본을 원장이 textarea 에서 수기 수정(editor = SSOT).
- **AC-5** UI 필요 데이터 모양을 DA CONSULT 스레드에 '제안'(테이블 직접 생성 금지). → MSG-20260616-150605-4q49. 권장안 = form_templates/form_submissions 재사용(KOH 동형).

## Phase 2 구현 (이번 배포 — commit 902422aa+28553a33, DA 재판정 GO=MSG-20260616-151210-xxy7)
> ⚠ **설계 SUPERSEDE**: 1차 2테이블안(`opinion_doc_templates`/`opinion_documents`, commit 07f61224)은 DA 재판정으로 **폐기·WITHDRAWN**(`20260616120000_opinion_documents.*.WITHDRAWN`). 정본 = **KOH form 스택 재사용**(GO_REUSE_A). 소견서 = KOH와 동일 의료문서 라이프사이클 → 전용테이블 신설 = dual-pattern 안티패턴.

- **DB** ADDITIVE only 마이그(`20260616160000_opinion_doc_form_stack.sql` + `.rollback.sql`). 파괴 0 → 대표 게이트 면제(autonomy §3.1), supervisor DDL-diff 게이트만.
  - **★C1(CRITICAL, 비협상)**: `form_submissions` published 행 비가역 하드닝(의료법 제22조). (a) `BEFORE UPDATE OR DELETE` 트리거 `form_submissions_published_immutable_guard` → `OLD.status='published'` 면 RAISE. (b) `form_submissions_update` USING 에 `status <> 'published'` 술어 추가(이중방어). ※ **KOH 발행본도 동시 보호**(기존 잠복 갭 해소). draft/printed/signed/voided/completed 무영향. 2026-06-16 probe: 현 prod published 행 0건 → 회귀 0.
  - **템플릿**: `form_templates` 1행 `form_key='opinion_doc'`, `field_map`=진단서/금기증 옵션·문구 그리드. **신규 enum/컬럼 0**. AC-8 설정 UI = 기존 form_templates CRUD 재사용.
  - **발행본**: `form_submissions` 1행 `status='published'`(★기존 CHECK 재사용, KOH 마이그 20260615190000 에서 추가됨). 실컬럼=clinic_id/template_id/check_in_id/customer_id/issued_by(FK 기존 무결성) + `field_data`(jsonb): selected_option_keys/final_text(수기 SSOT)/doctor_name·면허 스냅샷/chart_no 스냅샷/published_at/supersedes_id.
- **AC-6** '최종 발행' → `publish_opinion_doc(check_in_id, field_data)` RPC = `publish_koh_result` 동형(권한게이트+snapshot 병합+atomic insert). `window.confirm` 가드. **C4**: 정정=UPDATE 금지, 신규 발행(append-only, KOH dup-block 미적용). **C3** 정정 체인 = `field_data.supersedes_id`(self-FK 컬럼 신설 대신 field_data 채택 — KOH field_data 선례 동형, 스키마 churn 0).
  - **★C2(발행 게이트)**: `is_doctor_role()` = **director|doctor 만**(의료법 §17 진료의 전속, DA ruling B). `is_admin_or_manager` 재사용 **금지**(admin/manager 비의사 발행=§17 위반). KOH(행정 release=is_admin_or_manager)와 의도적으로 다른 게이트. **FE `canPublish` 도 동일**(director|doctor) — QuickRxBar.isDoctor(director|admin|manager, Rx취소용) 재사용 안 함(admin/manager dead-button 방지, commit 28553a33).
  - SELECT(발행 이력 조회·데스크 출력)=clinic 전 직군 유지(AC-7 무영향).
- **AC-7** 데스크 서류 출력 — `printOpinionDoc.ts`: 기존 `diag_opinion` HTML 양식 + `bindHtmlTemplate`(L-006) + window.open 인쇄(printKohResult 동일 패턴, 기존 form_submissions 출력 경로) 재사용. **신규 출력 스택 0**. 발행본 field_data 스냅샷 그대로 출력(재조회 변조 불가).
- **AC-8** 템플릿 설정 UI = 기존 form_templates CRUD(field_map 편집) 재사용. 현재 opinion_doc 템플릿 read wiring(빈 field_map 안전 — 하드코드 fallback).

## supervisor DDL-diff checks (self)
- ① 파괴 0 — 트리거/RLS술어/seed/RPC/표준함수 CREATE only. 기존 테이블·컬럼 ALTER/DROP 없음. 신규 테이블 0. ✅
- ② ★C1 published 비가역 — UPDATE/DELETE published 행 → '발행된 의무기록…' 42501. form_submissions_update USING 에 `status<>'published'`. **KOH published 행 회귀 0** 확인 요(현 prod published 0건). ✅
- ③ ★C2 발행 게이트 — `is_doctor_role()`(director|doctor) 외 호출 시 42501. is_admin_or_manager 잔존 0(검증 DO 블록 assert). FE canPublish 동치. ✅
- ④ clinic 격리 — publish RPC 가 check_in→clinic 해석, form_submissions RLS(clinic_id) 적용. ✅

## 검증
- `npm run build` OK.
- E2E `tests/e2e/T-20260616-foot-OPINION-DOC-FEATURE.spec.ts` — S4 발행게이트(director|doctor only, admin/manager 제외) PASS, S8 form 스택 field_data shape PASS, 외 toggle/resolveIssuer/join 로직 + 실브라우저 렌더 PASS.
- 마이그 끝 `DO $verify$` 블록 = 트랜잭션 내 C1 트리거/RLS술어 + opinion_doc seed + publish RPC + C2 is_doctor_role 게이트 assert.
- 렌더 evidence: `evidence/T-20260616-foot-OPINION-DOC-FEATURE_dialog.png`.

## ⚠ 배포 순서 (prod apply gate)
1. **supervisor DDL-diff GO** → `20260616160000_opinion_doc_form_stack.sql` prod 적용.
2. 마이그 적용 **후** FE 배포(템플릿/published 행 부재 시 graceful degrade — 발행이력 빈 안내, 옵션 그리드 fallback).
- 롤백 = `20260616160000_opinion_doc_form_stack.rollback.sql`(트리거 DROP + RLS술어 원복 + RPC/함수 DROP + seed 삭제). **⚠ KOH 보호 트리거 공유** — 롤백 시 KOH published 비가역도 함께 풀림(supervisor 인지).

## 비고 (현장 풀이)
- 이번 단계에서 '최종 발행'이 켜집니다 — 발행하면 소견서가 의무기록으로 저장되고, **저장 후에는 수정·취소가 안 됩니다**(법적 의무기록이라 그렇습니다). 잘못 발행하면 새로 발행(이전본은 이력에 남음).
- 발행은 **원장(진료 의료진)만** 가능합니다. 관리자·상담·코디 계정은 작성·미리보기·출력만(발행 버튼 비활성).
- 데스크 출력은 기존 소견서 양식 그대로 인쇄됩니다(새 출력 화면 안 만듦).
- 옵션 버튼 문구는 설정에서 수정할 수 있으며(균검사지 설정과 동일한 방식), 설정 화면 진입점은 총괄님 확인 후 안내드립니다.
