import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Activity, Bell, ChevronDown, Compass, Grid3x3, LogOut, Menu, Moon, Monitor, Ship, Sparkles, Sun, Tag } from 'lucide-react';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import AlertCenter from '@/pages/Alerts';
import CollectionDashboard from '@/pages/Collection';
import CopilotPage from '@/pages/Copilot';
import DealFinder from '@/pages/Deals';
import FaresPage from '@/pages/Fares';
import ForecastPage from '@/pages/Forecast';
import Heatmap from '@/pages/Heatmap';
import Overview from '@/pages/Overview';
import { useAlerts, useLogout, useSession } from '@/hooks/queries';
import RouteDetail from '@/pages/RouteDetail';
import { RouteList } from '@/pages/Routes/RouteList';
import SnapshotExplorer from '@/pages/Snapshots';
import { applyTheme, useUi, type Theme } from '@/store/ui';
import { t } from '@/lib/i18n';

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_NAMES: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** The six page links, reused by the header (horizontal, always visible at `lg`+) and the mobile nav drawer (stacked). */
function MainNav({ unread, orientation, onNavigate }: { unread: number; orientation: 'horizontal' | 'vertical'; onNavigate?: () => void }) {
  const navClass = ({ isActive }: { isActive: boolean }) => `inline-flex items-center gap-1 text-sm ${isActive ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground'}`;
  return (
    <div className={orientation === 'horizontal' ? 'flex items-center gap-4' : 'flex flex-col gap-4'}>
      <NavLink to="/" end className={navClass} onClick={onNavigate}>
        <Compass size={14} /> {t('Overview')}
      </NavLink>
      <NavLink to="/deals" className={navClass} onClick={onNavigate}>
        <Tag size={14} /> {t('Deals')}
      </NavLink>
      <NavLink to="/heatmap" className={navClass} onClick={onNavigate}>
        <Grid3x3 size={14} /> {t('Heatmap')}
      </NavLink>
      <NavLink to="/copilot" className={navClass} onClick={onNavigate}>
        <Sparkles size={14} /> {t('Copilot')}
      </NavLink>
      <NavLink to="/collection" className={navClass} onClick={onNavigate}>
        <Activity size={14} /> {t('Collection')}
      </NavLink>
      <NavLink to="/alerts" className={navClass} onClick={onNavigate}>
        <Bell size={14} /> {t('Alerts')}
        {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground" aria-label={t('{n} new', { n: unread })}>{unread}</span>}
      </NavLink>
    </div>
  );
}

export default function App() {
  const { theme, setTheme } = useUi();
  const { data: session } = useSession();
  const logout = useLogout();
  const ThemeIcon = THEME_ICON[theme];
  const { data: alerts = [] } = useAlerts();
  const unread = alerts.filter((a) => a.status === 'new').length;
  const [navOpen, setNavOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const ThemeToggle = (
    <Button variant="ghost" size="sm" onClick={() => setTheme(NEXT_THEME[theme])} aria-label={t('Theme: {theme}', { theme: t(THEME_NAMES[theme]) })}>
      <ThemeIcon size={16} /> <span className="capitalize">{t(THEME_NAMES[theme])}</span>
    </Button>
  );
  const SignOut = session?.authRequired && (
    <Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="logout">
      <LogOut size={16} /> {t('Sign out')}
    </Button>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 rounded-md font-semibold hover:opacity-80 focus-visible:outline-2 focus-visible:outline-primary" data-testid="home-link" title={t('Go to the start page')}>
              <Ship size={20} className="text-primary" /> {t('Cruise Price Tracker')}
            </Link>
            <nav aria-label={t('Main')} className="hidden items-center gap-4 lg:flex">
              <MainNav unread={unread} orientation="horizontal" />
            </nav>
          </div>
          <div className="hidden items-center gap-1 lg:flex">
            <LanguageSwitch />
            {ThemeToggle}
            {SignOut}
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('Open menu')} onClick={() => setNavOpen(true)}>
            <Menu size={20} />
          </Button>
        </div>
      </header>
      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="right" aria-label={t('Main')}>
        <div className="flex flex-col gap-6">
          <MainNav unread={unread} orientation="vertical" onNavigate={() => setNavOpen(false)} />
          <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
            <LanguageSwitch />
            {ThemeToggle}
            {SignOut}
          </div>
        </div>
      </Drawer>
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[18rem_1fr]">
        {isDesktop ? (
          <aside>
            <RouteList />
          </aside>
        ) : (
          <>
            <Button variant="outline" className="w-full justify-between" onClick={() => setRoutesOpen(true)}>
              {t('Routes')} <ChevronDown size={16} />
            </Button>
            <Drawer open={routesOpen} onClose={() => setRoutesOpen(false)} side="left" aria-label={t('Routes')}>
              <RouteList onNavigate={() => setRoutesOpen(false)} />
            </Drawer>
          </>
        )}
        <div className="min-w-0">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/collection" element={<CollectionDashboard />} />
            <Route path="/alerts" element={<AlertCenter />} />
            <Route path="/routes/:id/forecast" element={<ForecastPage />} />
            <Route path="/routes/:id/fares" element={<FaresPage />} />
            <Route path="/deals" element={<DealFinder />} />
            <Route path="/heatmap" element={<Heatmap />} />
            <Route path="/copilot" element={<CopilotPage />} />
            <Route path="/routes/:id" element={<RouteDetail />} />
            <Route path="/routes/:id/snapshots" element={<SnapshotExplorer />} />
            <Route path="*" element={<p className="text-muted-foreground">{t('Page not found.')}</p>} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
