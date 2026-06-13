---
ticket_id: T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-13
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (2/5)
commit_sha: c9dd3c4
---

## 요청

원천: NEW-TASK MSG-20260613-231633-xy3r (planner, P2).
1번차트(CheckInDetailSheet) 구성 변경 3건 + 치료부위 조건부 연동.

대상: src/components/CheckInDetailSheet.tsx 단일. UI-only, DB 무변경.

## 수행 (4 AC)

- **AC-1/2 차트번호 중복 제거** — 이름 하단 단독 차트번호 div 제거, 이름 옆
  차트번호(`data-testid="chartno-inline"`)만 유지 → 화면당 1회 노출.
- **AC-3 섹션 순서 재정렬** — 치료부위(조건부) → 금일동선 → 패키지 → 예약메모 →
  고객메모 → 기타메모 → 진료이미지 → 결제 → 서류발행.
  (경과분석지·KOH균검사는 선행 T-20260522-foot-CHART1-TRIM에서 비노출 처리됨 →
  현 코드엔 미렌더, 순서 체인에서 자연 제외. 결제>서류발행 = 기존
  CHART1-PAYMENT-ORDER 유지, 회귀 아님.)
  방문경로/예약메모/고객메모/기타메모 블록을 패키지 섹션 아래로 이동.
- **AC-4 치료부위 조건부 연동** — 2번차트에서 생성된 경우(`treatment_memo.foot_sites`
  존재)에만 1번차트에 read-only 표시(`data-testid="chart1-toe-readonly"`,
  `FootToeIllustration readOnly`). 단방향 read 바인딩 — 1번차트는 표시만, 편집 UI 없음.
  위치는 맨 위 유지(순서 이동 없음). foot_sites 없으면 미렌더(현행 유지).

구현은 선행 commit c9dd3c4(item4 치료부위 일러스트 + dedup/reorder 동시 반영)에
포함. 본 deploy-ready는 spec 추가·라이브 검증·아티팩트 확정.

## 검증

- `npm run build` (tsc 포함) 통과.
- E2E spec 4 시나리오 — 라이브 시딩(service key) 전부 GREEN (5 passed):
  - S-1: 차트번호 — 이름 옆 배지 1개 + 발번값 포함, 하단 단독 div 0개 (AC-1/AC-2).
  - S-2: 섹션 순서 — (치료부위 조건부) < 금일동선 < 예약메모 < 고객메모 < 기타메모 < 결제 (AC-3).
  - S-3: 회귀 없음 — Sheet 정상 오픈, JS 에러 0, 차트번호 배지 유지.
  - S-4: 치료부위 — 2번차트 생성분(foot_sites)만 read-only 표시 + 금일동선보다 위(맨 위 유지) + 편집 컨트롤 0 (AC-4).
  - 음성 케이스(foot_sites 부재 → 미렌더)는 S-2 공용 핸들이 검증.

spec 핵심 보정: 칸반 카드 클릭이 1번차트(440px)+2번차트(wide·lazy)를 동시에 열어
role=dialog first()가 2번차트(로딩 중)를 잡던 문제 → chartno-inline 보유 dialog로
1번차트 정확 스코프 + 콘텐츠 풀-렌더 대기로 결정성 확보.

db_change 없음. UI-only·기존 testid/데이터 불변 → GO(2/5).
