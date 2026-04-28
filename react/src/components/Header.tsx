import { NavLink } from 'react-router-dom';

type Props = {
  connected: boolean;
};

export function Header({ connected }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__title">Autonomous Agent Reviewers</span>
      </div>
      <nav className="app-header__nav">
        <NavLink to="/" end className={({ isActive }) => 'app-nav__link' + (isActive ? ' is-active' : '')}>
          Dashboard
        </NavLink>
        <NavLink to="/agents" className={({ isActive }) => 'app-nav__link' + (isActive ? ' is-active' : '')}>
          Agents
        </NavLink>
      </nav>
      <div className="app-header__status" title={connected ? 'SSE connected' : 'SSE disconnected'}>
        <span className={'status-dot ' + (connected ? 'status-dot--ok' : 'status-dot--off')} />
        <span className="status-label">{connected ? 'live' : 'offline'}</span>
      </div>
    </header>
  );
}
