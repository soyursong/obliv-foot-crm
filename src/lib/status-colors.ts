// Centralized status colors — single source of truth
export const STATUS_COLORS = {
  waiting:           { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', border: 'border-gray-200' },
  consultation:      { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' },
  treatment_waiting: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-400', border: 'border-yellow-200' },
  treatment:         { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500', border: 'border-green-200' },
  payment_waiting:   { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500', border: 'border-purple-200' },
  done:              { bg: 'bg-green-50', text: 'text-green-600', dot: 'bg-green-400', border: 'border-green-200' },
  no_show:           { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200' },
  unpaid:            { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500', border: 'border-orange-200' },
} as const;

export const STATUS_KO: Record<string, string> = {
  waiting: '대기',
  consultation: '상담',
  treatment_waiting: '시술대기',
  treatment: '시술중',
  payment_waiting: '결제대기',
  done: '완료',
  no_show: '노쇼',
  unpaid: '미결제',
};

export function getStatusBadgeClass(status: string): string {
  const c = STATUS_COLORS[status as keyof typeof STATUS_COLORS];
  if (!c) return 'bg-gray-100 text-gray-600';
  return `${c.bg} ${c.text}`;
}
