---
id: T-20260629-foot-RRN-VERIFY-BADGE-PASTEL-SHRINK
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit: e7e1ac9f
deployed_at: 2026-06-29T20:05:00+09:00
bundle_hash: pending
summary: "/chart/{id} 고객정보 탭 주민번호(rrn) 행 '신분증 확인 필요' 배지 추가 톤다운(FE-only, className만). 선행 CHART2-IDVERIFY-PASTEL-SHRINK가 로즈 파스텔+절반 사이즈로 만들어둔 뒤 현장 재요청으로 색 한 단계 더 저채도 전환: bg-rose-100/text-rose-400/border-rose-200 → bg-pink-100/text-pink-400/border-pink-200, dot bg-rose-300→bg-pink-300. 사이즈는 이미 절반 목표치(text-xs/px-1.5/py-0.5/font-medium) 도달 → 유지. 배지 노출 조건/전환 로직/텍스트 불변, 주민번호 마스킹·RLS·저장/편집 로직 일절 미접촉(RRN-SAVE-NOREFLECT/EDIT-WIPE-FIX와 직교). 신규 spec 6개 + 선행 canonical spec AC1 rose→pink 갱신, 13 passed. 빌드 5.13s OK. DB 변경 없음."
created: 2026-06-29
assignee: dev-foot
db_change: false
e2e_spec_exempt_reason: n/a
---

# T-20260629-foot-RRN-VERIFY-BADGE-PASTEL-SHRINK — '신분증 확인 필요' 배지 추가 톤다운(파스텔 핑크)

## 배경
풋 CRM /chart/{id} → 고객정보 탭 → 주민번호(rrn) 옆 '신분증 확인 필요' 배지.
선행 T-20260629-foot-CHART2-IDVERIFY-PASTEL-SHRINK(canonical)에서 진한레드→로즈 파스텔 +
절반 사이즈로 1차 톤다운했으나, 현장(스크린샷 20260629_194212.png)에서 여전히 채도가 높게
느껴진다는 재요청 → 색을 한 단계 더 저채도(로즈→파스텔 핑크)로 톤다운.

## 작업범위
- 변경 ①(색): `bg-rose-100 text-rose-400 border-rose-200` → `bg-pink-100 text-pink-400 border-pink-200`,
  도트 `bg-rose-300` → `bg-pink-300` (저채도 파스텔 핑크).
- 변경 ②(사이즈): 선행 티켓에서 이미 절반 목표치(text-xs/px-1.5/py-0.5/gap-1/font-medium) 달성 → 유지.
- 단일 파일 `src/pages/CustomerChartPage.tsx` 의 '신분증 확인 필요' button className만 교체.

## 보존 경계(불가침)
- 배지 노출 조건/전환 로직 미접촉 (verified 분기 · markIdVerified · disabled={!latestCheckIn} 보존).
- 주민번호 마스킹·RLS·저장/편집 로직 일절 미접촉 (RRN-SAVE-NOREFLECT / RRN-EDIT-WIPE-FIX와 직교).
- 배지 텍스트 문구('신분증 확인 필요') 유지.

## 게이트
GO — db_change=false 순수 FE, ADDITIVE 비파괴 → DA consult·대표게이트 면제, supervisor 일반 QA만.

## 검증
- 빌드 `npm run build` 5.13s OK.
- E2E: tests/e2e/T-20260629-foot-RRN-VERIFY-BADGE-PASTEL-SHRINK.spec.ts (현장 시나리오 2종 변환, 6 tests)
  + 선행 canonical spec AC1 rose→pink 갱신. **13 passed**.

## deploy
- commit: e7e1ac9f (main push 완료, Vercel 자동배포)
