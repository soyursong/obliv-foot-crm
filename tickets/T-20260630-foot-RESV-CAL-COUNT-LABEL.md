---
id: T-20260630-foot-RESV-CAL-COUNT-LABEL
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 5f7afcda11
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "예약관리 일간(가로 시간격자) 슬롯 헤더 — 시간(예 10:30) 텍스트 바로 아래 full-width 한 줄에 초/재/힐러 3종 건수를 통일 표기. AC1 부분표기 제거: 종전 헤더는 0건 종을 칩 생략(`{n>0 && ...}`)해 '초2 재1'처럼 부분표기(힐러0 누락) → 0 포함 항상 3종 노출(전 슬롯 일관), 例 '초2 · 재1 · 힐러0'. AC2 산식=kindCounts(@/lib/resvSlotAgg resvKind SSOT·취소 제외) 그대로 — 이미 로드된 resvByKey 재사용(신규쿼리 0). AC3 좁은 90px 컬럼: 종전 [시간|칩]/[+버튼] 좌우 1행 → 헤더 세로 2단(시간행+(+)버튼 / 건수행 full-width)으로 재배치, 건수행 text-[8px]+whitespace-nowrap(줄넘침 X)+전폭 사용(좌우분할 해소로 overflow 방지). AC4 0 처리=0 표기(초0/재0/힐러0)로 화면 내 일관. AC5 색컨벤션(T-20260625-COLOR-CONVENTION-UNIFY A안: 초진 파랑 blue/재진 초록 firstvisit/힐러 노랑 healer-700)·순서(초→재→힐러)·(+)버튼 위치·openNewSlot 동선·예약카드/색 무변경(presentation only). 단일 surface(일간 가로격자 resv-day-hslot)만 변경 — 주간 table per-cell(line~2225)·요일 헤더(line~2100)는 미접촉(별도 surface, AC5 동선 무변경). 미사용 `total` 지역변수 제거(noUnusedLocals). FE-only / DB·RPC 무변경. build OK(5.41s). E2E spec 5/5 PASS(desktop-chrome, 실 seed 데이터): S1 3종 통일표기+순서, S2 0처리 일관(토큰 정확히 3), S3 줄넘침/overflow 가드+시간 바로 아래 위치."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-RESV-CAL-COUNT-LABEL.spec.ts
medical_confirm_gate: n/a (예약관리 일간 캘린더 — 진료대시보드/진료관리 비대상, §11/§11.1)
data_consult: n/a (신규 컬럼·테이블·enum 없음 — DDL 0, §S2.4 자문 게이트 비대상)
coordination: 동일 파일 Reservations.tsx 내 다른 건수 surface(요일 헤더 day-summary line~2100 / 주간 table per-cell cell-kind-count line~2225)는 별도 surface로 본 티켓 범위 외 — 미접촉. 색컨벤션은 T-20260625-foot-COLOR-CONVENTION-UNIFY(A안) 준수.
---

## 요청 (현장 / planner NEW-TASK)
origin C0ATE5P6JTH 풋센터, 김주연 총괄, thread 1782785111.693999.
예약관리 캘린더 각 시간 슬롯 헤더 — 시간(예 10:30) 텍스트 바로 아래 한 줄에 초진/재진/힐러 건수 3종을 통일 표기. 현재 일부 슬롯만 "초2 재1" 부분표기됨. 포맷 例 "초2 · 재1 · 힐러0"(작은 텍스트, 한 줄).

## AC
- AC1 모든 슬롯 헤더에 초/재/힐러 3종 건수 한 줄 표시(3종 일관, 부분표기 X)
- AC2 건수=해당 슬롯 예약 visit-type별 집계 정확값(이미 로드된 예약배열 사용, 신규쿼리 불요)
- AC3 시간 텍스트 바로 아래 한 줄·작은 텍스트, 좁은 폭에서도 overflow/줄넘침 X
- AC4 0 처리(표시 vs 생략)는 가독성 기준 dev 판단 — 화면 내 규칙 일관
- AC5 기존 카드/색/동선 무변경(헤더 라벨만 추가/통일)

## 구현
- src/pages/Reservations.tsx 일간 가로격자 슬롯 헤더(resv-day-hslot-{time}): 좌우 1행 → 세로 2단.
  - 1단: 시간 span + (+) 버튼(justify-between, 동선·onClick 불변)
  - 2단: 건수행 `<span data-testid="resv-day-hslot-count-{time}">` — 초{n} · 재{rr} · 힐러{h} 항상 3종(0 포함).
  - 색: text-blue-700 / text-firstvisit-700 / text-healer-700 (A안), 중점 구분자 muted.
  - 미사용 `const total` 제거.
- 산식 kindCounts(time) 그대로 재사용(resvKind SSOT, 취소 제외).

## E2E
tests/e2e/T-20260630-foot-RESV-CAL-COUNT-LABEL.spec.ts (5/5 PASS, desktop-chrome 실 seed):
- [S1] 모든 슬롯 헤더 라벨에 초/재/힐러 3종 토큰 + 순서(초→재→힐러)
- [S2] 0 처리 일관 — 라벨마다 토큰 정확히 3개(부분표기 검출)
- [S3] 한 줄(줄넘침 X)·컬럼 폭 내·시간 텍스트 바로 아래 위치
