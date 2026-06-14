---
id: T-20260614-foot-MEDREC-LAYOUT-4REFINE
title: "[진료차트] 진료기록 패널 레이아웃 정밀 4묶음 (border-left·너비정렬·안내멘트·단일행)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: PENDING
created: 2026-06-14
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260614-033152-02z1
risk_verdict: GO
---

# T-20260614-foot-MEDREC-LAYOUT-4REFINE

진료기록 패널(MedicalChartPanel) 레이아웃 정밀 수정 4묶음. 100% FE presentation, DB/저장/비즈로직 무변경.
같은 패널 5차+ 연속 피드백(문지은 대표원장).

## REDEFINITION 화해 (§13.1.A) — AC-4
AC-4는 T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE ②(진료일/담당의 정렬, deployed 06-13)를 supersede.
reporter "진짜 여러번 말하는데 왜자꾸 헤더랑 아래내용구조로 가는거지?"
→ **근본원인**: 직전 수정들은 진료일·담당의 두 필드를 좌우로 배치만 했지, 각 필드 내부 라벨이
`block`(라벨 위) + 입력칸(아래) = 필드마다 '헤더+내용 2단'으로 렌더된 게 원인.
→ 라벨을 `block`→`inline`(`whitespace-nowrap`)으로 전환 + `flex items-center` 한 행에
'진료일 [날짜]  담당 의사 [의사]'를 모두 인라인 배치. 라벨 stacking 제거가 핵심.
경고문(미선택/의사없음)만 select 바로 아래 컬럼으로 흘려 단일 행 외형 유지(저장 NOT NULL 게이트 무변경).

## AC 결과
- **AC-1 ✅** 임상경과 + 의료진전용메모 좌측 세로줄(`border-l-2 border-gray-300 pl-3`) 제거 → 소헤더로 식별.
- **AC-2 ✅** 치료사차트(좌 `sm:flex-[4]`) | 치료메모(우 `sm:flex-[1]`) — 아래 임상경과/의료진메모와 동일 4:1 비율로 정렬(기존 1:1 균등 폐지, 컬럼 경계 일치).
- **AC-3 ✅** 처방내역 헤더 우측상단 안내 span('우측 패널에서 처방세트 선택') 제거 → `justify-between`→단순 `flex`. 미리보기(formRx 테이블/빈 상태) 유지.
- **AC-4 ✅** 진료일+진료의 단일 행 — 라벨 `block`→`inline` 전환, `flex items-center` 한 행 인라인 배치.

## 자가검증 (preview 실측 + 시각)
- 빌드 OK (`npm run build` 3.86s).
- spec: `tests/e2e/T-20260614-foot-MEDREC-LAYOUT-4REFINE.spec.ts` 신규(8 case) + T-20260612 spec ② supersede 갱신 → 17 passed.
- **AC-4 실 브라우저 실측**: `scripts/..._render.mjs` — 진료일 라벨 Y=148 = 입력칸 Y=148, deltaY=0 → `AC4_SINGLE_ROW_OK`(헤더+내용 2단 아님). JS 렌더에러 0(404 리소스만).
- 시각 증거(evidence/): `_AC4_singlerow.png`(한 줄), `_DX-RX.png`(AC-3 멘트 제거), `_TX-TREATMEMO.png`(AC-2 4:1), `_NOTES-2COL.png`(AC-1 세로줄 제거).

## 후속
- soak 후 reporter(문지은 대표원장) confirm으로 패널 레이아웃 최종 확정 목표.
- AC-4 6차 재요청 방지 — 근본원인(라벨 stacking) 제거 확인됨.
