import { Link, useLocation } from 'react-router-dom'
import { ProfileMenu } from './ProfileMenu'
import { NotificationBell } from '../notifications/NotificationBell'
import styles from './AppHeader.module.css'

interface AppHeaderProps {
  userName: string
  onLogout: () => void
}

export function AppHeader({ userName, onLogout }: AppHeaderProps) {
  const location = useLocation()
  const currentPath = location.pathname

  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        {/* Монохромный логотип из гайдлайна, белый на фиолетовой шапке (public/rt-logo-white.png) */}
        <img className={styles.logo} src="/rt-logo-white.png" alt="Ростелеком" />
        <nav className={styles.nav}>
          <Link
            to="/"
            className={`${styles.navLink} ${currentPath === '/' ? styles.navLinkActive : ''}`}
          >
            {/* На телефоне в шапку влезает только короткое название */}
            <span className={styles.labelFull}>Радар присутствия</span>
            <span className={styles.labelShort}>Радар</span>
          </Link>
          <span className={styles.navSeparator}>|</span>
          <Link
            to="/navigator"
            className={`${styles.navLink} ${currentPath === '/navigator' ? styles.navLinkActive : ''}`}
          >
            Навигатор
          </Link>
          <span className={styles.navSeparator}>|</span>
          <Link
            to="/calc"
            className={`${styles.navLink} ${currentPath === '/calc' ? styles.navLinkActive : ''}`}
          >
            <span className={styles.labelFull}>Калькулятор</span>
            <span className={styles.labelShort}>Расчёт</span>
          </Link>
        </nav>
        <div className={styles.headerActions}>
          <NotificationBell />
          <Link
            to="/subscriptions"
            className={`${styles.subscriptionsLinkDesktop} ${
              currentPath === '/subscriptions' ? styles.navLinkActive : ''
            }`}
          >
            Подписки
          </Link>
          <span className={styles.userNameDesktop}>{userName}</span>
          <button onClick={onLogout} className={styles.logoutButtonDesktop}>
            Выйти
          </button>
          <div className={styles.profileMenuMobile}>
            <ProfileMenu userName={userName} onLogout={onLogout} />
          </div>
        </div>
      </div>
    </header>
  )
}
