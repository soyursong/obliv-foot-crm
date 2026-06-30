---
id: T-20260630-foot-DASH-REVISITBOX-CHARTNO-REMOVE-MISU-SHRINK
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: d7b46a7a05
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "대시보드 통합시간표 '재진 고객박스'를 초진 박스 구성(성함+폰뒷자리+미수유무)과 정합 + 미수 딱지 더 축소. AC1 재진 박스 차트번호(#F-…) 제거=6/30 REVISIT-CUSTBOX 적용분 유지(활성 재진 박스 2종 — 체크인 카드 TimelineCheckInCard returning / 재진 예약 카드 DraggableBox2ResvCard 전부 차트 미표기, 폰뒷4만), 본 티켓은 회귀 spec로 보증. 레거시 Box2ReservationCard(line~1713 #차트)는 미사용 dead code(@ts-ignore, 미렌더) → scope_guard로 무수정. AC2 초진 구성 정합=재진 식별자 폰뒷4자리(\\d{4}). AC3 미수 배지 CSS 더 축소=REVISIT_MISU_BADGE_CLS 상수 신설(text-[7px] px-px py-0 leading-none whitespace-nowrap), 기존 text-[8px] px-0.5 대비 폰트·패딩 추가 축소, whitespace-nowrap=clip 가드('미수' 2글자 줄바꿈/잘림 방지), twMerge로 base(text-[9px] px-1 py-px) override. 상수 단일화로 체크인·예약 두 곳 divergence 방지. AC4 색컨벤션(T-20260625 field-lock blue/firstvisit)·레이아웃·실시간 반영(OutstandingMapCtx 단일소스) 무변경, 초진(new) 미수 배지·#차트번호 무수정. presentation only / DB·RPC 무변경. build OK(4.96s). spec 5/5 PASS(AC1~4 결정론+회귀) + 선행 REVISIT-CUSTBOX spec 5 PASS(S4 기준 7px 갱신)."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-DASH-REVISITBOX-CHARTNO-REMOVE-MISU-SHRINK.spec.ts
medical_confirm_gate: n/a (대시보드 통합시간표 접수 surface — 진료대시보드/진료관리 비대상)
coordination: T-20260630-foot-DASH-INTAKEBOX-BRIEFMEMO-SHOW(초진 박스, commit 0a7fc720 旣배포분) 同 surface — 초진=간략메모 표기(무수정 유지) / 재진=차트제거+배지축소(본 티켓). 동일 박스 컴포넌트군이나 별도 라인 → 충돌 없음.
---

## 요청 (현장 / planner NEW-TASK)
대시보드 통합 시간표 '재진 고객박스'를 초진 박스 구성(성함+폰뒷자리+미수유무)과 정합 — 차트번호 아직 표시됨 → 제거. + 미수 딱지(배지) 사이즈 더 작게.

## AC
- AC1 재진 박스 차트번호 제거
- AC2 초진 구성(DASH-INTAKEBOX 라인)과 항목 정합 (성함+폰뒷4+미수)
- AC3 미수 배지 CSS 축소(폰트·패딩, clip 가드)
- AC4 색컨벤션(T-20260625 field-lock)·레이아웃·실시간 반영 무변경

## 구현
- src/pages/Dashboard.tsx: REVISIT_MISU_BADGE_CLS 상수 신설(text-[7px] px-px py-0 leading-none whitespace-nowrap) → 재진 체크인 카드·재진 예약 카드 미수 배지 className 적용.
- 차트번호 제거(AC1)·폰뒷4(AC2)는 旣적용분(6/30 REVISIT-CUSTBOX) 유지 → 회귀 spec로 고정.

## 검증
- npm run build OK / tsc --noEmit OK
- E2E: tests/e2e/T-20260630-foot-DASH-REVISITBOX-CHARTNO-REMOVE-MISU-SHRINK.spec.ts 5/5 PASS
- 선행 spec REVISIT-CUSTBOX S4 기준 text-[7px]로 갱신 → 5 PASS

## 비고
- db_change=false (旣적재값 read·표시 항목/CSS만). 대표게이트 불요(autonomy §3.1).
