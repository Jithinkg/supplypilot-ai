import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, Package2, ClipboardList, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from './auth';
import { api } from '@/lib/api';

export function AppShell() {
  const session = useSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const logout = useMutation({ mutationFn: async () => { if (session.data) await api.logout(session.data.csrfToken); }, onSuccess: async () => { await queryClient.cancelQueries(); queryClient.clear(); queryClient.setQueryData(['session'], null); } });
  if (session.isPending) return <p role="status" className="p-8">Loading workspace…</p>;
  if (session.error) return <main className="p-8"><p role="alert">{session.error.message}</p><Button className="mt-4" onClick={() => void session.refetch()}>Retry connection</Button></main>;
  if (!session.data) return <Navigate to="/login" replace />;
  return <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
    <aside className="border-b bg-card p-6 md:min-h-screen md:border-r md:border-b-0">
      <div className="flex items-center gap-3"><Package2 className="size-8 text-primary" aria-hidden /><div><span className="font-semibold">SupplyPilot AI</span><p className="text-xs text-muted-foreground">Procurement workspace</p></div></div>
      <nav aria-label="Main navigation" className="mt-6 flex flex-wrap gap-2 md:mt-9 md:flex-col">{[{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/proposals', label: 'Proposals', icon: ClipboardList }, { to: '/knowledge', label: 'Knowledge', icon: BookOpen }].map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-muted'}`}><Icon className="size-4" aria-hidden />{label}</NavLink>)}</nav>
      <p className="mt-8 hidden text-xs leading-relaxed text-muted-foreground md:block">Human decisions.<br />Clear procurement visibility.</p>
    </aside>
    <div className="min-w-0"><header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-4 md:px-10"><span className="text-sm text-muted-foreground">Workspace / {location.pathname.startsWith('/proposals') ? 'Proposals' : location.pathname.startsWith('/knowledge') ? 'Knowledge' : 'Dashboard'}</span><div className="flex flex-wrap items-center gap-4"><span className="text-xs text-muted-foreground">{session.data.user.email} · {session.data.user.role}</span><Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut className="size-4" aria-hidden />Sign out</Button></div>{logout.error && <p role="alert" className="text-sm text-destructive">{logout.error.message}</p>}</header><Outlet context={session.data} /></div>
  </div>;
}
