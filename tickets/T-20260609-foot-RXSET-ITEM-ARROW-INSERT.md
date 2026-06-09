---
id: T-20260609-foot-RXSET-ITEM-ARROW-INSERT
title: "[처방세트] 약품폴더 항목 좌측 `<` 즉시삽입 버튼 + '선택추가' 제거"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 4e57242
created: 2026-06-09
assignee: dev-foot
reporter: 현장
source_msg: MSG-20260609-185910-2n7x
needs_field_confirm: true
related_tickets:
  - T-20260606-foot-RX-SET-REDESIGN
  - T-20260607-foot-RXQUICK-SET-FOLDER-NAV
---

# T-20260609-foot-RXSET-ITEM-ARROW-INSERT

## 요청 (planner NEW-TASK)
진료차트 우측 처방세트(약품폴더) 탭 각 약품 항목 좌측에 ChevronLeft `<` compact 버튼(w-6 이하) 추가 →
클릭 시 기존 "선택추가" 삽입 로직 **재사용**해 즉시 좌측 처방 목록 삽입. "선택추가" 버튼 제거/숨김.
다중약 세트 일괄삽입 동작 GUARD 유지.

## 범위 가드
- 대상 = MedicalChartPanel 우측 '처방세트' 탭의 약품 폴더 트리(`DrugFolderTree`).
- QuickRxBar(빠른처방 admin)·상용구 탭 미접촉 — QUICKRX-MULTI-DRUG / PHRASE-CHECKBOX-ARROW 영역.
- `<` 비주얼 = ChevronLeft, compact(w-5 ≤ w-6), 좌측 여백, teal-600 (PHRASE-CHECKBOX-ARROW 톤 일관).
- 기존 `onAdd([단건])` 재사용만 — onClick 복제/신규작성 금지.

## 구현 (FE-only, db_change=false)
- `src/components/doctor/DrugFolderTree.tsx`
  - 각 약품 항목 좌측에 `<`(ChevronLeft) compact 버튼(`drug-folder-item-arrow`) 추가 →
    `addOne(d)` = 기존 `onAdd([{id,name_ko,classification}])` 재사용 → 즉시 좌측 처방내역 삽입.
  - 체크박스(`drug-folder-item-check`) + '선택 추가'(`drug-folder-add-selected`) bulk UI 제거.
  - `selected` state / `toggleSelect` / `addSelected` 사장 코드 제거. `Button`/`Plus` import 정리.
- 묶음처방 다중약 일괄삽입 GUARD: `PrescriptionSetTreePicker`(loadPrescriptionSet) **미변경** →
  세트 1클릭 시 약 전체 일괄 적재 동작 보존 + QuickRxBar 공용 컴포넌트 영향 0.

## E2E
- `tests/e2e/T-20260609-foot-RXSET-ITEM-ARROW-INSERT.spec.ts`
  - S1 (정상 1클릭 삽입): 약품 좌측 `<` 클릭 → 처방내역 1행 + bulk UI 부재 GUARD.
  - S2 (다중약 세트 일괄삽입 GUARD): 묶음처방(약 2개) 1회 클릭 → 세트 내 약 전체(2행) 적재.
- 기존 `T-20260606-foot-RX-SET-REDESIGN.spec.ts` S2: 체크박스/선택추가 경로 → `<` 순차 클릭으로 갱신.

## 검증
- `npm run build` OK (3.73s).
- commit 4e57242 push (main → Vercel 자동, pre-push 차트가드 PASS).

## supervisor QA
- 진료차트 '처방세트' 탭 약품 폴더 펼침 → 각 약품 좌측 `<` 버튼 노출 + 1클릭 즉시 좌측 처방내역 삽입.
- '선택 추가' 버튼/체크박스 미노출 확인.
- 묶음처방(다중약) 클릭 시 약 전체 일괄삽입 회귀 0.
- Vercel 번들 해시 확정 권장.
