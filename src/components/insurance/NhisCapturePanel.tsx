/**
 * NhisCapturePanel — 건보 자격 수기조회 안내 패널 (수기 선택 only)
 *
 * T-20260724-foot-NHIS-PARSER-REMOVE-MANUAL-ONLY (이은상 팀장 confirm=B, 파서 롤백)
 *   [건보조회] 클릭 → 포털 딥링크가 열리고 이 패널이 노출된다. 데스크는 포털에서 자격여부를
 *   눈으로 확인한 뒤, 우측 '건강보험 자격등급'(InsuranceGradeSelect)에서 등급을 직접 선택해 저장한다.
 *   붙여넣기 자동파싱(파서)·거짓 "다른 환자" 경고·등급 자동입력은 모두 제거됨(수기 선택만 write).
 *
 * PHI: RRN·인증서는 CRM/클라우드를 경유하지 않음(포털·데스크 PC 내부 종결). 이 패널은 안내만 한다.
 */

import { ExternalLink, Info, X } from 'lucide-react';
import { NHIS_EXTERNAL_URL, type NhisLookupController } from '@/hooks/useNhisLookup';

interface Props {
  customerName: string | null;
  controller: NhisLookupController;
}

export function NhisCapturePanel({ customerName, controller }: Props) {
  const { closeCapture } = controller;

  return (
    <div
      className="rounded-lg border border-teal-300 bg-teal-50/40 overflow-hidden"
      data-testid="nhis-capture-panel"
    >
      {/* 헤더 — 조회 대상 신원 에코 (오조회 방어) */}
      <div className="flex items-center justify-between border-b border-teal-200 bg-teal-100/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-800">
          <Info className="h-3.5 w-3.5" />
          <span>건보 자격 조회</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-teal-700" data-testid="nhis-capture-identity">
            대상: <b>{customerName ?? '(이름 미상)'}</b>
          </span>
          <button
            type="button"
            onClick={closeCapture}
            title="닫기"
            className="rounded p-0.5 text-teal-700 hover:bg-teal-200/60 transition"
            data-testid="nhis-capture-close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {/* 안내 — 수기 선택 동선 */}
        <p className="text-[11px] leading-snug text-teal-700" data-testid="nhis-capture-guide">
          공단 포털에서 자격을 조회해 <b>자격여부를 눈으로 확인</b>한 뒤,
          오른쪽 <b>건강보험 자격등급</b>에서 등급을 직접 선택해 저장해 주세요.
        </p>
        <a
          href={NHIS_EXTERNAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 transition"
          data-testid="nhis-capture-portal-link"
        >
          <ExternalLink className="h-3 w-3" />
          포털 열기 (요양기관 정보마당)
        </a>
      </div>
    </div>
  );
}
