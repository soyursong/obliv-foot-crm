---
id: T-20260603-foot-MEDCHART-SUPERPHRASE-EXT
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 26b8c42
deployed_at: 2026-06-04T00:30:00+09:00
bundle_hash: pending-vercel
created: 2026-06-03 23:49
deadline: 2026-06-10
assignee: dev-foot
reporter: 문지은 대표원장
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
db_changed: false
e2e_spec_exempt_reason: null
related: [T-20260603-foot-RX-CHART-FOLLOWUP3, T-20260603-foot-RX-SUPER-PHRASE, T-20260526-foot-MEDCHART-SYNC]
source_msg: MSG-20260603-234922-qvi1
---

# T-20260603-foot-MEDCHART-SUPERPHRASE-EXT — 진료차트 슈퍼상용구 등록 UX 확장 4종

## 배경
FOLLOWUP3 C-2(슈퍼상용구 등록 UX 정제)에서 외부 API 의존(2-4 약용량 자동조회)을 분리하고,
나머지 4종(2-1·2-2·2-3·2-5)을 본 티켓으로 처리. RX-SUPER-PHRASE / MEDCHART-SYNC 인프라 위 정제.
타겟 = 어드민 `SuperPhrasesTab`(슈퍼상용구 등록 폼) — 시나리오 B.

## 수용 기준 (AC)
- **2-1 (진단명)**: 진단명 슬롯 → 등록된 진단명(`medical_charts.diagnosis` 이력 + `super_phrases.diagnosis`) datalist 자동완성. ✅
- **2-2 (임상경과)**: 임상경과 슬롯 → 진료차트 상용구(`phrase_templates`, phrase_type='medical_chart') Select 선택 → 내용 append. ✅
- **2-3 (처방내역)**: 처방내역 슬롯 → 처방세트(`prescription_sets`) Select 선택 → 빈 약품명 행 정리 후 항목 불러오기(append). ✅
- **2-5 (횟수)**: 처방 횟수 = 숫자만 저장(`3`), "회"는 필드 배경 suffix(값 미포함). 음수/소수 방지, 빈칸=null. ✅
- ⚠️ **2-4 (약용량) 제외** → 별도 `T-...-foot-RX-DRUGINFO-DOSAGE`(BLOCK, 외부 약정보 레퍼런스 조사 선행).

## 구현
- 신규 `src/components/admin/RxCountInput.tsx` — 숫자만 + "회" 배경 suffix (2-5).
- `src/components/admin/PrescriptionSetsTab.tsx` — PrescriptionItem.count 추가(JSONB additive), 횟수칸=RxCountInput, 용법(frequency)과 분리.
- `src/components/admin/SuperPhrasesTab.tsx` — useRegisteredDiagnoses/useMedicalPhrases/useRxSetsLite 훅 + datalist(2-1) + 임상경과 상용구 Select(2-2) + 처방세트 Select(2-3).

## DB
- **변경 없음**. count는 JSONB(prescription_sets.items / super_phrases.rx_items) 내 nullable 필드라 마이그 불요.
- 조회 대상 테이블(medical_charts, super_phrases, phrase_templates, prescription_sets) 모두 기존.

## 검증
- `npm run build` PASS
- E2E `tests/e2e/T-20260603-foot-MEDCHART-SUPERPHRASE-EXT.spec.ts` 16 pass
- commit `26b8c42` push(origin/main)

## supervisor QA 메모
- 본 커밋은 C-2만 포함. 작업 트리에 별개 C-1 후속(DoctorCallDashboard.tsx) 미커밋분 존재 — 본 티켓 범위 아님(C-1은 d2ea1e1로 이미 deploy-ready). 본 커밋에 미포함.
- 회귀: SuperPhrasesTab 기존 저장/적용(RX-SUPER-PHRASE) 로직 불변, Select는 등록 폼에만 추가.
