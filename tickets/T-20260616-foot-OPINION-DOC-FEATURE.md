---
id: T-20260616-foot-OPINION-DOC-FEATURE
title: "[소견서] 균검사지 옆 신규 기능 — 금일 내방객 + 옵션 그리드 팝업 + editor (Phase 1 scaffold)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: none
commit_sha: 871309e8
created: 2026-06-16
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260616-141848-ygnp
risk_verdict: GO_WARN
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1781491923.605529"
da_consult_ref: MSG-20260616-141830-o298
da_proposal_msg: MSG-20260616-150605-4q49
phase: 1
---

# T-20260616-foot-OPINION-DOC-FEATURE — 소견서 신규 기능 (Phase 1)

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

## Phase 2 (DA GO 후 — 별도 착수)
- **AC-6** '최종 발행' → 소견서 저장(비가역, confirm 가드). 현재 버튼 '준비중' disabled.
- **AC-7** 데스크 서류 출력 연동 — 기존 풋 CRM 서류 출력 경로 재사용(신규 출력 스택 금지).
- **AC-8** 템플릿(옵션·문구) 설정 UI 위치 제안 → planner/총괄 confirm. (Phase 1 옵션·문구는 하드코드 placeholder 기본값.)

## 검증
- `npm run build` OK.
- E2E `tests/e2e/T-20260616-foot-OPINION-DOC-FEATURE.spec.ts` — 10 PASS (toggle 로직 9 + 실브라우저 렌더/팝업 1).
- 렌더 evidence: `evidence/T-20260616-foot-OPINION-DOC-FEATURE_dialog.png` (옵션 그리드 + 자동삽입 editor + 발행 disabled 확인).

## 비고 (현장 풀이)
- DB 변경 없음(이번 배포). '저장'은 다음 업데이트에서 켜집니다 — 지금은 작성·수정 화면 미리보기.
- 옵션 버튼 문구는 임시 기본값이며, 다음 단계에서 원장님/총괄님 확인 후 설정 화면에서 바꿀 수 있게 만듭니다.
