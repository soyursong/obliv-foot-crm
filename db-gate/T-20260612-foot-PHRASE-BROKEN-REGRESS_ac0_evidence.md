# T-20260612-foot-PHRASE-BROKEN-REGRESS — AC-0 read-only 진단 증거

- 작성: agent-fdd-dev-foot · 2026-06-12
- 신고: 김주연 총괄(C0ATE5P6JTH) — "상용구 어제(06-11) 하루종일 안 됨"
- 성격: 회귀(working→broken) 신고 / 1줄·첨부無 → AC-0 추정금지·재현확정 선행
- 모드: **READ-ONLY (SELECT·git·정적분석만, write 0)**

## 0. 대상 surface 식별
- `//`(슬래시) 상용구 자동완성·삽입 = **`src/components/MedicalChartPanel.tsx` (진료차트 임상경과 칸) 전용.**
- `handleClinicalChange`(L1198) → `//query` 정규식 매칭 → `phrasePopoverVisible` → `insertPhrase`(일반)/`applySuperPhraseFromSlash`(슈퍼).
- "처방 칸"은 슈퍼상용구(`applySuperPhrase`)가 진단명+임상경과+처방을 일괄 라우팅하는 경로로 연결(별도 `//` 핸들러 없음).
- 참고: `PenChartTab.tsx`의 "상용구"는 펜캔버스 폼-텍스트 템플릿(별개 기능, `//` 슬래시 아님).

## 1. 코드 무결성 (4단계 RC 후보 점검)
| RC 후보 | 코드 위치 | 상태 |
|---|---|---|
| ① 트리거 미발동 | `handleClinicalChange` L1198~1211, 정규식 `/\/\/([^\s/]*)$/` | 정상. textarea `autoComplete=off` 등 네이티브 가로채기 차단(L3035) 유지 |
| ② 목록 미로딩 | `loadData` L717 phrase_templates / L744 super_phrases 조회 | 정상. 필터 `is_active=true`, 앱 쿼리=probe 쿼리 동일 |
| ③ 선택·삽입 | `insertPhrase` L1234 / `applySuperPhraseFromSlash` L1257 | 정상. `//query` 토큰 대체 로직 무변경 |
| ④ 저장 누락 | `handleSave` L1146~ | 무관(삽입은 formClinical state) |
- portal/caret 의존 무결: `createPortal`(L49 import), `getTextareaCaretRect`(L421 정의) 존재 — 렌더 크래시 아님.
- 빌드: `npm run build` PASS (현재 main 컴파일 무결 → 배포 번들 런타임 크래시 아님).

## 2. 06-11 배포 대조 (회귀 원점 추적)
06-11~06-12 MedicalChartPanel 변경 커밋 전수 diff 확인 — **phrase 경로 미접촉**:
- `73c4965` 진료기록 패널 UI 정리 → 진료일|담당의사 flex 배치 / '읽기전용' badge 제거 / 저장버튼명. **phrase·textarea onChange 무변경.**
- `1dd558e` clinicalInit 레이스 게이트(`chartsLoadedRef`) → `variant==='clinical'`(인라인 패널) today차트 자동선택 타이밍만. **`//` 트리거·readOnly 무관.**
- `3cbd175` 2번차트 저장 dirty 리셋 → Sheet onInput proxy. **phrase 무관.**
- 최근 phrase 계열 마지막 변경 = `4e8df2b`(06-09, caret 좌표) / `76fb99f`(06-06) — 06-11 이전. **06-11 배포가 phrase 경로를 회귀시킨 커밋 없음.**

## 3. 데이터/RLS 증거 (probe: `scripts/T-20260612-foot-PHRASE-BROKEN-REGRESS_ac0_probe.mjs`)
DB: rxlomoozakkjesdqjtvd (prod)
```
[service_role / RLS bypass]
  phrase_templates(is_active=true): 34건  shortcut_key보유=1  type={pen_chart:33, medical_chart:1}
  super_phrases(is_active=true):     1건
  phrase_templates 전체=34 / 활성=34 / 비활성=0
  최근 updated_at = 2026-06-03 (★06-11 데이터 플립/비활성화 없음)
[anon / public]
  phrase_templates: 0건 / super_phrases: 0건  ← 정상(테이블 read 정책 = TO authenticated)
```
- RLS 정책(마이그 정의):
  - `phrase_templates` `staff_read_phrase_templates` = `FOR SELECT TO authenticated USING (true)` (20260504_doctor_treatment_flow_up.sql L89)
  - `super_phrases` `staff_read_super_phrases` = `TO authenticated USING (true)` (20260603060000_super_phrases.sql L45)
  → **로그인 스태프(authenticated)면 role 무관 전원 읽기 가능.** anon=0은 정상(미인증).
- 06-11 마이그레이션 전수 확인: phrase_templates / super_phrases 테이블·정책 **직접 변경 없음**. 06-11 RLS 마이그(clinic_events / closing / room_assignments 등)는 phrase 테이블·공용 헬퍼 미접촉.

## 4. 판정
- **"목록 미로딩 → RLS/role 회귀 → DB게이트 승격" 가설 = 반증.** (데이터 존재 + RLS authenticated-open + 06-11 무변경)
- **전(全) 상용구 outage 코드/데이터 근거 = 미발견.** 진료차트 `//` 경로는 현재 코드·데이터·RLS 전부 정상.
- AC-0 규정상 **재현 불가 + RC 미확정 → dev 임의 추정 코딩 금지.** → planner FOLLOWUP(어느 화면/칸/증상 + 스크린샷).
- DB게이트 승격 **불요**(RLS 회귀 아님). P1 재triage 플래그 **미발동**(전 outage 근거 없음).

## 5. FOLLOWUP 요청 항목(현장 확인 필요)
1. 어느 화면? (진료차트 임상경과 칸 / 진료대시보드 인라인 임상경과 / 펜차트 중 택1)
2. 어느 증상? (`//` 쳐도 드롭다운 안 뜸 / 떠도 클릭해도 안 들어감 / 들어가도 저장 후 사라짐)
3. 특정 PC/태블릿만인지, 전 기기인지 (브라우저 캐시·구번들 가능성 배제용)
4. 가능하면 화면 스크린샷 1장.
