import { CheckSquare } from 'lucide-react';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-lg font-semibold ${className}`}>
      <CheckSquare className="size-6 text-blue-600" aria-hidden />
      Taskop
    </span>
  );
}
