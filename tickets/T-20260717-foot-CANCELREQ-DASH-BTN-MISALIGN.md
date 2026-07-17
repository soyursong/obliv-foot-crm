---
id: T-20260717-foot-CANCELREQ-DASH-BTN-MISALIGN
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 5ca7c647
deployed_at: 2026-07-17T19:03:09+09:00
bundle_hash: pending (CF Pages main-push 자동빌드 후 supervisor QA에서 확인)
db_change: false
summary: 진료대시보드 소견서·진단서 처리대기 큐의 '요청 취소' 버튼에서 ⊗아이콘+텍스트가 버튼 경계를 벗어나 overflow/wrap 되던 정렬 결함 수정. RC=취소 버튼의 `block` 유틸이 shadcn Button base의 `inline-flex` 를 덮어써 flex 중앙정렬 무력화 → h-6 안에서 icon+text overflow. block→flex(+items-center/justify-center/leading-none) 치환. 순수 FE/CSS, 취소 로직 무변경.
created: 2026-07-17
assignee: dev-foot
medical_confirm_gate: required
confirm_status: confirmed
---

## 배경 (현상)

풋CRM **진료대시보드** → 소견서·진단서 처리대기 목록. 각 행 '발행' 컬럼의 '요청 취소' 버튼에서
⊗ 아이콘 + "요청 취소" 텍스트가 **버튼 경계를 벗어나 overflow/wrap**.
바로 위 형제 '작성하기' 버튼은 경계 내 정상 렌더. (P2, red 색박스 주석 스크린샷 2장 근거 / planner MSG-20260717-133406-7103)

- 착수 게이트: blocked→approved (planner 해제, `medical_confirm_gate` confirmed)
- 코드 경로: `src/components/doctor/DocRequestQueue.tsx` (DocRequestRow 발행 셀)

## 원인 (RC)

shadcn Button base(`src/components/ui/button.tsx`) = `inline-flex shrink-0 items-center justify-center …`.
'요청 취소' 버튼이 `className="mt-1 block h-6 w-full …"` 로 **`block`** 을 추가 →
tailwind-merge(`cn`)가 base 의 `inline-flex` 를 `block` 으로 덮어씀 → `display:block`.
flex 컨텍스트가 사라지면서 base 의 `items-center`/`justify-center`(flex 전용)가 무력화 →
고정 높이 `h-6`(24px) 안에서 icon(svg)+text 가 세로 중앙정렬되지 못하고 line-box 가 경계 밖으로 overflow.
형제 '작성하기' 버튼은 `block` 을 쓰지 않아 base flex 유지 → 정상 렌더(대조군).

## 수정 (순수 정렬 CSS)

`block` → `flex`(+ 명시 `items-center justify-center leading-none`). `w-full`(전폭) 유지.
- flex = block-level flex 컨테이너 → w-full 로 셀 전폭 채우며 base 정렬 복원.
- leading-none = line-height 팽창으로 h-6 초과 방지.
- 취소 로직·핸들러·onClick(`onCancel(r)`)·확인 다이얼로그·mutation(`reason:'cancelled'`) **전부 무변경.**

## AC 결과

- AC-1 ✅ overflow/wrap 해소 — flex 정렬 복원, icon+text 경계 내 중앙정렬 (h-6 유지)
- AC-2 ✅ 취소요청 동작 무회귀 — 핸들러/mutation 경로·testid·라벨 보존
- AC-3 ✅ 형제 '작성하기' 버튼과 정렬 일관, TABLEVIEW 9칼럼·완료 그룹 회귀 없음

## 검증

- `npm run build` ✅ (built in 9.73s)
- E2E: `tests/e2e/T-20260717-foot-CANCELREQ-DASH-BTN-MISALIGN.spec.ts` — 7 passed
- db_change=false, 순수 FE/CSS (risk=GO)

## 현장 확인 (갤탭 실기기 confirm 대상)

진료대시보드 → 소견서·진단서 처리대기 목록 → '요청 취소' 버튼 ⊗+텍스트가 버튼 테두리 안 한 줄 중앙정렬,
overflow/wrap 없음. 형제 '작성하기'와 정렬·톤 일관. 태블릿 폭 포함 주요 뷰포트 레이아웃 정상.
