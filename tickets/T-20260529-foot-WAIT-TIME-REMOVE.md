---
id: T-20260529-foot-WAIT-TIME-REMOVE
domain: foot
priority: P2
status: deploy-ready
title: 접수 완료 화면 대기 예상 시간 제거
created: 2026-05-29
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260529-foot-WAIT-TIME-REMOVE.spec.ts
deploy_commit: 4c6f737f0e7cef6be3c93d06e6909d447096f219
---

# T-20260529-foot-WAIT-TIME-REMOVE — 접수 완료 화면 대기 예상 시간 제거

## 요청
김주연 총괄: 셀프접수 완료 화면에 노출되는 "잠시만 기다려 주세요." / "Please wait to be called." 문구 제거.

## 변경 내용
- `T` 인터페이스에서 `waitMsg` 필드 제거
- ko 번역에서 `waitMsg: '잠시만 기다려 주세요.'` 삭제
- en 번역에서 `waitMsg: 'Please wait to be called.'` 삭제
- `step === 'done'` 완료 화면 JSX에서 `<br />` + `{t.waitMsg}` 렌더링 제거

## AC 검증
- AC-1: 완료 화면에서 대기 안내 문구 완전 제거 ✓
- AC-2: 나머지 요소(대기번호·완료 메시지·자동 리셋 타이머·새 접수 버튼) 정상 유지 ✓
- AC-3: 워크인·예약 양쪽 동일 `done` 화면 사용 → 단일 수정으로 양쪽 적용 ✓

## 영향 범위
- FE only (src/pages/SelfCheckIn.tsx)
- DB 변경 없음

## 빌드
`npm run build` ✓ (commit 4c6f737)
