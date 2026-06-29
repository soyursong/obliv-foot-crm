---
id: T-20260629-foot-SIDEBAR-DAYHIST-COMPACT-MONOTONE
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit: cdc2495e
deployed_at: 2026-06-30T02:22:17+09:00
bundle_hash: pending
summary: "사이드바 '일일 이력'(/admin/history, src/pages/DailyHistory.tsx) 화면 컴팩트·모노톤(FE presentation only, DB 무변경). 현장(김주연 총괄): 화면 전체 폰트·레이아웃 약 절반으로 압축(정보밀도 약 2배) + 불필요한 컬러 전부 제거 모노톤 통일. (AC-1 컴팩트) 외곽 p-6→p-3·섹션 gap-6→gap-3, 요약 카드헤더 p-4→p-2·CardContent p-4→p-2, 큰 숫자 text-2xl→text-base·보조 text-lg→text-sm, 타임라인 행 p-4→p-2·gap-3→gap-2, 큐번호 원형 size-8→size-6, 모든 테이블 py-1.5/py-2→py-1·text-xs→text-[11px]/[10px], 필터 탭/정렬/방문유형 토글 높이·패딩 축소 — 전부 실제 px 단계 축소(scale() 미사용). (AC-2 모노톤) teal/blue/emerald/amber/red/rose 등 유채색 전부 제거→gray 스케일. 공유 상수 STATUS_COLOR/VISIT_TYPE_COLOR(타 화면 영향)는 미변경, 본 화면 한정 로컬 토큰 statusMono()(cancelled<done<진행중 채움농도+굵기 차등)·VISIT_MONO 도입. 색에만 의존하던 상태/방문유형/결제유형 구분은 기존 텍스트 라벨 + 채움농도/굵기로 보존(정보손실 0). 미결제·노쇼 강조 카드는 amber/red bg→border-gray-400 bg-gray-50 + font-bold text-gray-900로 형태 강조 전환. (AC-3) 표시항목 전부 유지(차트번호 칼럼·환자명 단독노출 0·결제 수정/취소/삭제 액션·감사로그 패널), 펼침/필터/정렬/방문유형 토글·태블릿 터치 무회귀. E2E 신규 spec(S1 컴팩트 토큰 p-3/gap-3 + 요약 카드 노출 + 루트 하위 유채색 클래스 0건 가드 / S2 필터탭·정렬토글·방문유형·접수카드 펼침 상호작용 무결) — auth 포함 3 passed(실 인증 앱 대상). 빌드 5.32s OK. DB 변경 없음, data-architect CONSULT 불요. 1차 조정분 — 총괄 preview 후 미세조정 1라운드 예상."
created: 2026-06-29
assignee: dev-foot
db_change: false
e2e_spec_exempt_reason: n/a
---

# T-20260629-foot-SIDEBAR-DAYHIST-COMPACT-MONOTONE — 사이드바 '일일 이력' 컴팩트·모노톤

## 배경
현장(김주연 총괄): 사이드바 **'일일 이력'** 메뉴 화면 전체 폰트·레이아웃이 너무 크고 컬러가 많다 → 화면 전체를 현재의 **약 절반 수준**으로 컴팩트화(정보밀도 약 2배) + 불필요한 컬러 전부 제거해 **모노톤** 통일 요청.

대상: `/admin/history` (사이드바 라벨 '일일 이력', `src/pages/DailyHistory.tsx`). 운영 화면이며 진료대시보드/진료관리(의사 전용·문원장 컨펌 게이트) 비대상 — 게이트 없음.

## AC
- **AC-1 컴팩트**: 본문 폰트·행높이·셀/카드 padding·여백 약 50% 축소(실제 px 단계 축소, `scale()` 금지). 정보밀도 약 2배.
- **AC-2 모노톤**: 강조색/컬러뱃지/아이콘컬러 등 제거→그레이스케일. 기존 모노톤 토큰 재사용. 색에만 의존하던 상태구분은 텍스트/형태/굵기로 보존(정보손실 금지).
- **AC-3 무손상**: 압축·탈색 후 겹침·깨짐·필수정보 잘림 없음. 클릭/hover/스크롤/정렬/필터 정상(태블릿 터치 포함). 표시항목 유지.

## 구현 요약
- 컴팩트: 외곽 `p-6→p-3`·`gap-6→gap-3`, 요약 2개 그리드 `gap-4→gap-2`, `CardHeader pb-2→p-2 pb-1`·`CardContent p-4→p-2 pt-0`, 큰 숫자 `text-2xl→text-base`·`text-lg→text-sm`, 타임라인 행 `p-4 gap-3→p-2 gap-2`, 큐번호 `size-8 text-sm→size-6 text-xs`, 펼침 영역 `px-4 py-3→px-2 py-2`, 모든 테이블 `py-1.5/2→py-1`·`text-xs→text-[11px]`·헤더 `text-[10px]` 유지, 필터 탭/정렬 버튼 `h-7 text-xs`, 방문유형 토글 `px-2 py-0.5 text-[11px]`.
- 모노톤: `statusMono(status)`(cancelled `gray-50/400` < done `gray-100/600` < 진행중 `gray-200/800 font-semibold` — 채움농도+굵기 차등) + `VISIT_MONO`(`gray-100/700`) 로컬 토큰. 결제유형 배지(결제/환불/취소)·노쇼 배지·상태전환 배지·미결제/패키지 안내박스·결제 액션 버튼(수정/취소/삭제) 전부 gray화. 큐번호·차트번호·달력 아이콘 teal→gray. 미결제·노쇼 강조 카드 amber/red→`border-gray-400 bg-gray-50`+`font-bold text-gray-900`. 공유 `STATUS_COLOR`/`VISIT_TYPE_COLOR` import 제거(타 화면 미영향).
- 정보보존: 모든 배지에 기존 텍스트 라벨(STATUS_KO/VISIT_TYPE_KO/결제유형) 그대로 유지, 환불 `-` 부호·취소 line-through 유지 → 색 제거해도 구분 정보 손실 0.

## 검증
- E2E: `tests/e2e/T-20260629-foot-SIDEBAR-DAYHIST-COMPACT-MONOTONE.spec.ts` — S1(컴팩트 토큰 p-3/gap-3 + 요약 카드 노출 + 루트 하위 유채색 클래스[teal/blue-6/emerald/amber/rose/red-5] 0건) / S2(필터탭·정렬토글·방문유형·접수카드 펼침 상호작용 무결). auth 포함 **3 passed** (실 인증 앱 대상, port 8089).
- `npm run build` OK (5.32s). DB 변경 없음.

## 후속
- 1차 조정분. 총괄 preview 후 폰트/여백 미세조정 1라운드 예상(현장 피드백 대기).
