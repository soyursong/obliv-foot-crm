---
id: T-20260625-foot-BUNDLERX-DRUGROW-MEMO-REMOVE
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260625-foot-BUNDLERX-DRUGROW-MEMO-REMOVE.spec.ts
e2e_spec_exempt_reason: null
deploy_ready_commit: f2548afd
created: 2026-06-25
assignee: dev-foot
reporter: 문지은 대표원장
medical_confirm_gate: required
confirm_status: confirmed
confirm_basis: >
  director 본인 자기요청(신고자=문지은 대표원장 U0ALGAAAJAV) — 동일 surface(PrescriptionSetsTab 묶음처방/처방세트)·동일 reporter
  형제 티켓 T-20260624-foot-BUNDLERX-ICON-NOAPPLY(confirm_status: confirmed, 동일 basis)와 동일 클래스로 §11.1 self-request 예외 충족.
  ※ 게이트 부여·confirm 전환은 planner 책임(§11.1) — dev-foot는 형제 confirmed 미러로 마킹 완료, planner 정정 필요 시 FIX-REQUEST 회신 바람.
planner-msg: MSG-20260625-105125-n0ds
---

# T-20260625-foot-BUNDLERX-DRUGROW-MEMO-REMOVE — 묶음처방 약 항목 행 설명(notes) 입력칸 제거

## 요약
"묶음처방 추가/수정" 모달의 약 항목 행(ItemRow)에서 **설명(notes) 입력칸 제거**.
약 항목 = 약이름 + 용량 + 횟수 + 일수(숫자 3종)만 노출. 메모는 처방세트(약품폴더 DrugFoldersTab '설명' 인라인)에서 등록.

## AC 충족
- **AC-0 그라운딩 게이트 PASS**: DrugFoldersTab(약품폴더)에 약별 '설명' 인라인 에디터(Part C, L714~770) 존재 확인 → 메모 등록처가 별도로 있어 reporter 멘탈모델("메모는 처방세트에서 등록") orphan 아님 → AC-1 정당 진행.
- **AC-1**: ItemRow에서 설명(notes) 입력칸(Label·placeholder "분류·메모"·data-testid="rx-set-item-notes-input"·onChange) 전부 제거. grid 재배분(name 4→5, days 1→2 = 12).
- **AC-1(동선 일관)**: ItemRow는 공유 컴포넌트 — 생성/수정 모달이 단일 렌더 사이트(L1461)를 공유하므로 두 동선 자동 일관 적용.
- **AC-2 데이터 안전**: PrescriptionItem.notes 타입/컬럼 보존(DROP 0). 저장은 items 배열 통째 upsert → onChange 미경유로 기존 notes 값 유실 0. db_change:false.
- **AC-3**: 흡수 출력(처방전 rx_items_html·미리보기 rxTooltip·진료차트)은 약이름+숫자토큰만, notes/route 미노출 — NAMEDESC AC4-1/AC4-2 회귀 spec으로 확인.
- **AC-4 회귀/좌표충돌**: 동일 파일 T-20260624-foot-BUNDLERX-ICON-NOAPPLY(deploy-ready, tag/icon 영역) 무충돌 — f2548afd가 그 위에 빌드 OK로 적층, 영역 비중첩.

## policy_superseded
T-20260610-foot-RXSET-NAMEDESC-MODEL Q2 LOCK("설명=상세관리화면 限 허용")의 surface 범위를 동일 reporter가 narrow:
"묶음처방 약항목엔 숫자3종만, 메모는 처방세트에서". NAMEDESC 핵심 정의("메모는 처방세트에서 등록")는 유지·강화, spec AC2-1 supersede 반영. 2층모델(PROCMENU-RX-UNIFY) 정합.

## 검증 (실측)
- build OK (vite 4.47s)
- E2E: 신규 spec 8 PASS + NAMEDESC 갱신 10 PASS = 18 passed (6.7s)
- DB변경: 없음

## 현장 클릭 시나리오
- 진입경로: 서비스관리(/admin/services) → 진료관리 서브탭 → 묶음처방(처방세트) 관리 → "묶음처방 추가" 또는 기존 세트 "수정"
- 계정: 문지은 대표원장(director, §11.1 self-request confirmed)
- 경로 A: 묶음처방 추가 모달 → 약 항목 행에 약이름 검색 + 용량/횟수/일수(숫자 3종) 입력칸만 보이고 "설명" 칸은 없음.
- 경로 B: 기존 묶음처방 수정 모달 → 동일하게 설명 칸 부재, 기존 저장된 notes 값은 화면 미노출이나 저장 시 유실 없이 영속.
- 경로 C: 약별 메모가 필요하면 약품폴더(DrugFoldersTab) '설명' 셀 더블클릭 인라인 편집으로 등록.
