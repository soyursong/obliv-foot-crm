---
id: T-20260609-foot-HANDOVER-PARTBOX-COLOR
domain: foot
priority: P2
status: deploy-ready
title: 인수인계 파트 박스(카드 섹션)에 파트 색 적용
created: 2026-06-09
assignee: dev-foot
reporter: 김주연 총괄
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260609-foot-HANDOVER-PARTBOX-COLOR.spec.ts
---

# T-20260609-foot-HANDOVER-PARTBOX-COLOR — 인수인계 파트 박스 색 적용

## 배경
/admin/handover 인수인계 카드(박스 섹션 컨테이너 = `handover-card`)가 흰 배경(bg-white)
이라, 파트 배지(PART_BADGE_CLASS)에만 색이 있고 박스에는 파트 구분 색이 없어 김주연 총괄
지적. → 박스에도 파트 색 적용.

## 구현 ("박스" 식별)
- "박스" = 선택일 인수인계 목록의 각 카드 컨테이너 `[data-testid="handover-card"]`
  (Handover.tsx 본문, 파트별 1건 = 1박스). 파트 섹션 컨테이너로 확정.
- `src/lib/handover.ts` — `PART_BOX_CLASS: Record<string,string>` 신설(SSOT 재사용,
  신규 색값 도입 없음). 박스는 배지보다 연한 톤:
  - 공통=indigo → `bg-indigo-50 border-indigo-200`
  - consultant_lead(상담실장)=rose → `bg-rose-50 border-rose-200`
  - coordinator(코디)=amber → `bg-amber-50 border-amber-200`
  - therapist(치료사)=teal → `bg-teal-50 border-teal-200`
  - fallback → `bg-white border-slate-200`
  - 정적 literal 클래스 → Tailwind JIT purge 안전.
- `src/pages/Handover.tsx` — `handover-card` div: `bg-white` 제거, `partBoxClass(n.part_code)`
  적용 + `data-part` 부착(테스트/디버그용).

## 회귀가드 (무회귀)
- 이름칩(NAMECARD-ROLECOLOR, 상담 sky/코디 yellow/치료 green): 색값·클래스 변경 없음.
- 파트 배지(PART_BADGE_CLASS, *-100/*-700): 변경 없음 — 박스 섹션 배경/테두리만 추가.
- 작성/수정/삭제·파트탭·통합합산·캘린더 3뷰·출근자명단(ATTENDEE-LAYOUT): 무회귀.

## E2E (2 시나리오)
- S1. 치료사 인수인계 작성 → 박스에 teal 톤(bg-teal-50/border-teal-200) 렌더 + bg-white 제거,
  배지 teal-100 유지 검증.
- S2. 이름칩·파트 필터·작성 폼·3뷰 토글 무회귀.
- 결과: `T-20260609-foot-HANDOVER-PARTBOX-COLOR` 3 passed (setup+S1+S2).

## deploy-ready 보고 (planner 회신)
1. "박스" 식별 = `handover-card` 카드 컨테이너(파트 섹션 컨테이너) 맞음. (불명 아님)
2. 치료사 teal 적용 후 "초록" 느낌: 박스는 연한 teal-50이라 배지(teal-100/700)와 자연스럽게
   조화. 현장에서 "초록" 부족 판단 시 teal→green SSOT 1줄 교체는 별도 REV로 분리 권장
   (이름칩 치료=green과 톤 통일 의도라면 REV에서 일괄).
