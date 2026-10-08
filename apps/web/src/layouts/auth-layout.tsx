import { Outlet } from '@tanstack/react-router';
import { Logo } from '@/components/logo';

export function AuthLayout() {
  return (
    <div className="bg-muted/40 flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Logo />
      <div className="bg-background w-full max-w-md rounded-xl border p-8 shadow-sm">
        <Outlet />
      </div>
    </div>
  );
}
