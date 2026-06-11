---
id: T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR
title: "인수인계 출근명단 상담 파트 칩 색 sky→rose 전환"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-11
deploy_ready_at: 2026-06-11
commit_sha: 03594ae
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR.spec.ts
---

## 개요

김주연 총괄 요청 — 인수인계 "오늘 출근 명단" 칩에서 상담(consultant) 파트 색을
하늘(sky)에서 로즈(rose)로 변경. 코디(yellow)·치료(green)는 유지.

## 변경

- `src/lib/status.ts` `STAFF_ROLE_CARD_CLASS.consultant`:
  `bg-sky-100 text-sky-800 border-sky-300` → `bg-rose-100 text-rose-800 border-rose-300`
  (정적 클래스 — Tailwind JIT purge 안전, 동적 클래스 미사용)
- 정렬은 `roleIdx`(STAFF_ROLE_ORDER) 이미 적용 → 변경 없이 검증만.

## AC4 회귀가드

- 코디=yellow / 치료=green 칩 무회귀
- 미매칭 역할(director·technician 등) → 중립 slate fallback 무회귀
- 정렬 순서(상담→코디→치료) 무회귀
- PARTBOX 박스색 / 인수인계 작성·수정·삭제는 본 변경과 무관 (status.ts 칩 매핑 1곳만 수정)

## 테스트

- 신규: `tests/e2e/T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR.spec.ts` (S1~S4, 단일 진실원천 결정적 가드)
- 회귀: `tests/e2e/T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR.spec.ts` 색 토큰 sky→rose 갱신
- `npm run build` 통과 / DB 변경 없음
