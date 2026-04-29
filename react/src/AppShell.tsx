import { Outlet } from 'react-router-dom';
import { Header } from './components/Header';
import { useApp } from './AppContext';

export function AppShell() {
  const { connected } = useApp();
  return (
    <div className="app-shell">
      <Header connected={connected} />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
