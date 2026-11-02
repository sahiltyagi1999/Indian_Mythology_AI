import { BarChart3, BookOpen, Clapperboard, FileText, Film, LayoutDashboard, ListChecks, Settings, Upload, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'Overview' | 'Story Engine' | 'Video Engine' | 'System';
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { href: '/sources', label: 'Story Sources', icon: Upload, group: 'Story Engine' },
  { href: '/library', label: 'Story Library', icon: BookOpen, group: 'Story Engine' },
  { href: '/scripts', label: 'Script Studio', icon: FileText, group: 'Story Engine' },
  { href: '/characters', label: 'Character Library', icon: Users, group: 'Story Engine' },
  { href: '/video-studio', label: 'Video Studio', icon: Clapperboard, group: 'Video Engine' },
  { href: '/videos', label: 'Video Library', icon: Film, group: 'Video Engine' },
  { href: '/queue', label: 'Generation Queue', icon: ListChecks, group: 'Video Engine' },
  { href: '/settings', label: 'AI Provider Settings', icon: Settings, group: 'System' },
  { href: '/analytics', label: 'Cost & Usage', icon: BarChart3, group: 'System' },
];

export function titleFor(pathname: string): string {
  const match = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)));
  return match?.label ?? 'Mahabharat AI Studio';
}
