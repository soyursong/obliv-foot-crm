/**
 * NhisCapturePanel — 건보 자격 수기조회 결과 인라인 캡처 UI
 *
 * T-20260724-foot-NHIS-MANUAL-CAPTURE (Phase 1)
 *   [건보조회] 클릭 → 포털 딥링크가 열리고 이 패널이 노출된다. 직원이 포털에서 조회한 결과를
 *   복사해 붙여넣기 칸(자동포커스 textarea)에 붙여넣으면 → 파서가 읽어 평문 에코 + 경고 표시.
 *   등급 확정은 우측 '건강보험 자격등급'(InsuranceGradeSelect)에서 사람이 클릭(자동확정 금지).
 *
 * PHI: RRN·인증서는 붙여넣기 텍스트에 없음(포털 마스킹). 이 패널은 평문 메타만 다룬다.
 * 하드가드: 이름대조 강경고(#4) / 나이↔등급 모순(#2) / 화이트리스트 외 자동저장 차단(#1) 을
 *   NhisParsedResult.warnings 로 받아 노출. 하드블록 없음(소프트게이트 #6).
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ClipboardPaste, ExternalLink, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { NHIS_EXTERNAL_URL, type NhisLookupController } from '@/hooks/useNhisLookup';

interface Props {
  customerId: string;
  clinicId: string;
  customerName: string | null;
  controller: NhisLookupController;
}

export function NhisCapturePanel({ customerId, clinicId, customerName, controller }: Props) {
  const { parsed, error, applyPaste, closeCapture } = controller;
  const [text, setText] = useState('');
  const [birthDateDisplay, setBirthDateDisplay] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 자동 포커스 (붙여넣기 즉시 가능)
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 나이가드용 생년월일 SSOT — fn_customer_birthdates(서버 rrn 복호, YYYY-MM-DD만 수신). 평문 rrn 미경유.
  useEffect(() => {
    let cancelled = false;
    if (!customerId || !clinicId) {
      setBirthDateDisplay(null);
      return;
    }
    supabase
      .rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: [customerId] })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) {
          setBirthDateDisplay(null);
          return;
        }
        const row = (data ?? [])[0] as { birth_date_display: string | null } | undefined;
        setBirthDateDisplay(row?.birth_date_display ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, clinicId]);

  const runParse = (raw: string) => {
    applyPaste(raw, { customerName, birthDateDisplay });
  };

  return (
    <div
      className="rounded-lg border border-teal-300 bg-teal-50/40 overflow-hidden"
      data-testid="nhis-capture-panel"
    >
      {/* 헤더 — 조회 대상 신원 에코 (오조회 방어) */}
      <div className="flex items-center justify-between border-b border-teal-200 bg-teal-100/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-800">
          <ClipboardPaste className="h-3.5 w-3.5" />
          <span>건보 자격 조회 결과 붙여넣기</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-teal-700" data-testid="nhis-capture-identity">
            대상: <b>{customerName ?? '(이름 미상)'}</b>
            {birthDateDisplay ? ` · ${birthDateDisplay}` : ''}
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
        {/* 안내 */}
        <p className="text-[11px] leading-snug text-teal-700">
          공단 포털에서 자격을 조회한 뒤 결과를 복사해 아래 칸에 붙여넣어 주세요.
          읽은 값을 확인하고, 오른쪽 <b>건강보험 자격등급</b>에서 등급을 확정하세요.
        </p>
        {error?.showFallback && (
          <a
            href={NHIS_EXTERNAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 transition"
          >
            <ExternalLink className="h-3 w-3" />
            포털 열기 (요양기관 정보마당)
          </a>
        )}

        {/* 붙여넣기 칸 */}
        <textarea
          ref={textareaRef}
          value={text}
          data-testid="nhis-capture-textarea"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (pasted) {
              // 붙여넣기 즉시 파싱 (state 반영 전 원문으로)
              setText(pasted);
              runParse(pasted);
              e.preventDefault();
            }
          }}
          rows={4}
          placeholder="포털 자격조회 결과를 여기에 붙여넣기 (Ctrl+V)"
          className="w-full rounded border border-teal-300 bg-white px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-teal-500"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => runParse(text)}
            disabled={!text.trim()}
            data-testid="nhis-capture-parse-btn"
            className="rounded bg-teal-700 text-white text-[11px] px-3 py-1.5 hover:bg-teal-800 transition disabled:opacity-50"
          >
            붙여넣기 읽기
          </button>
          {parsed && (
            <button
              type="button"
              onClick={() => {
                setText('');
                runParse('');
              }}
              className="rounded border border-neutral-300 bg-white text-[11px] px-3 py-1.5 text-neutral-600 hover:bg-neutral-100 transition"
            >
              지우기
            </button>
          )}
        </div>

        {/* 경고 (하드가드) */}
        {parsed && parsed.warnings.length > 0 && (
          <div className="space-y-1" data-testid="nhis-capture-warnings">
            {parsed.warnings.map((w, i) => (
              <div
                key={i}
                data-warn-code={w.code}
                className={cn(
                  'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug',
                  w.level === 'strong'
                    ? 'bg-red-50 border border-red-200 text-red-700 font-medium'
                    : 'bg-amber-50 border border-amber-200 text-amber-800',
                )}
              >
                <AlertTriangle
                  className={cn('h-3.5 w-3.5 shrink-0 mt-px', w.level === 'strong' ? 'text-red-600' : 'text-amber-600')}
                />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* 파싱 결과 평문 에코 */}
        {parsed && (
          <div
            className="rounded-md border border-teal-200 bg-white px-2.5 py-2 space-y-1 text-[11px]"
            data-testid="nhis-capture-echo"
          >
            <EchoRow label="수진자성명" value={parsed.patientName} testid="echo-name" />
            <EchoRow label="자격여부" value={parsed.eligibilityRaw} testid="echo-eligibility" />
            <EchoRow
              label="읽은 등급"
              value={parsed.suggestedGrade ? parsed.gradeLabelRaw : `${parsed.gradeLabelRaw ?? '—'} (자동제안 없음, 직접 선택)`}
              testid="echo-grade"
              highlight={!!parsed.suggestedGrade}
            />
            <EchoRow label="증번호" value={parsed.certNo} testid="echo-certno" />
            <EchoRow label="자격취득일" value={parsed.acquiredDate} testid="echo-acquired" />
            {parsed.suggestedGrade && (
              <p className="pt-0.5 text-[10px] text-teal-600">
                → 오른쪽 <b>건강보험 자격등급</b>에 '{parsed.gradeLabelRaw}'가 제안되었습니다. 확인 후 <b>저장</b>을 눌러 확정하세요.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EchoRow({
  label,
  value,
  testid,
  highlight,
}: {
  label: string;
  value: string | null | undefined;
  testid: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span
        data-testid={testid}
        className={cn('flex-1 break-all', highlight ? 'font-semibold text-teal-700' : 'text-gray-700')}
      >
        {value && value.trim() ? value : <span className="text-gray-300">—</span>}
      </span>
    </div>
  );
}
