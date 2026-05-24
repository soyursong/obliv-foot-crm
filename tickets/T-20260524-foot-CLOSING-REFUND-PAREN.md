---
id: T-20260524-foot-CLOSING-REFUND-PAREN
domain: foot
priority: P1
status: deploy-ready
title: 일마감 총 합계 환불 라벨 괄호 제거
created: 2026-05-24
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: exempt (typo/label-only)
commit_sha: 08e5597e091bc6130e71643ff2a42793205c5915
---

# T-20260524-foot-CLOSING-REFUND-PAREN — 일마감 총 합계 환불 라벨 괄호 제거

## 개요
`/closing` 총 합계 SummaryCard에서 "환불(차감 포함)" → "환불" 라벨 변경. FE-only typo 수정.

## AC (구현 완료)
- AC-1: ✅ SummaryCard `rows` 라벨 변경 — `['환불(차감 포함)', -totals.refundAmount]` → `['환불', -totals.refundAmount]` (L1095, commit 08e5597)
- AC-2: ✅ 인쇄 영역 확인 — L906 `<h3>환불</h3>` 원래부터 "환불" 표기, 수정 불필요
- AC-3: ✅ refundAmount 계산 로직(L481~496) 변경 없음
- AC-4: ✅ 빌드 성공 (08e5597 이후 45+ 커밋 모두 main 포함, idle-scan 3.30s ✓)

## 변경 파일
- `src/pages/Closing.tsx` — L1095 라벨 문자열만 수정 (FE-only)

## 선행 티켓
- T-20260523-foot-CLOSING-REFUND-LABEL (deployed, 6be2d79) — 결제내역 테이블 헤더 [관리]→[환불]

## 비고
- 3회 반복 요청 (ts 1779519214, 1779585164, 1779585203) 수렴
- e2e_spec_exempt: typo (label-only change)
- DB 변경 없음
