import { Settings, LogOut, Play, Biohazard, X, UserRound } from 'lucide-react';
import menuBackground from '../../background.png';

interface MainMenuScreenProps {
  username: string;
  isRoleSelectOpen: boolean;
  onOpenRoleSelect: () => void;
  onCloseRoleSelect: () => void;
  onStartVirusGame: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function MainMenuScreen({
  username,
  isRoleSelectOpen,
  onOpenRoleSelect,
  onCloseRoleSelect,
  onStartVirusGame,
  onOpenSettings,
  onLogout,
}: MainMenuScreenProps) {
  return (
    <section
      className="main-menu-screen relative flex-1 overflow-hidden text-white"
      style={{
        backgroundImage: `url(${menuBackground})`,
      }}
    >
      <div className="menu-hex-grid" />
      <div className="menu-scanline" />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <Biohazard className="w-[34vmin] h-[34vmin] text-red-500/18 drop-shadow-[0_0_42px_rgba(255,0,52,0.42)]" strokeWidth={1.2} />
      </div>

      <div className="absolute left-4 right-4 top-4 z-20 flex items-start gap-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-red-100/45">
          Project Z / Main Interface
        </div>
      </div>

      <div className="relative z-10 flex h-full items-end justify-between gap-6 px-4 pb-4 pt-20 sm:px-6 lg:px-8">
        <aside className="menu-panel w-full max-w-[360px]">
          <div className="menu-panel-title">
            <span>Главное меню</span>
          </div>
          <div className="space-y-5 px-6 py-7">
            <button className="menu-action-button" onClick={onOpenRoleSelect}>
              <Play className="w-5 h-5" />
              <span>Игра</span>
            </button>
            <button className="menu-action-button" onClick={onOpenSettings}>
              <Settings className="w-5 h-5" />
              <span>Настройки</span>
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-red-500/30 px-6 py-4 text-[10px] uppercase tracking-[0.2em] text-red-100/50">
            <span>{username || 'Operator'}</span>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-red-100/50 transition-colors hover:text-red-100"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Выход</span>
            </button>
          </div>
        </aside>
      </div>

      {isRoleSelectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="role-dialog w-full max-w-xl">
            <button
              onClick={onCloseRoleSelect}
              className="absolute right-4 top-4 text-red-100/55 transition-colors hover:text-white"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="mb-6 pr-10">
              <div className="text-[10px] uppercase tracking-[0.28em] text-red-300/60">Режим запуска</div>
              <h2 className="mt-2 text-2xl font-bold uppercase tracking-wide text-white">Выбор стороны</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <button className="role-choice role-choice-ready" onClick={onStartVirusGame}>
                <Biohazard className="w-9 h-9 text-red-300" />
                <span>За вирус</span>
                <small>Реализовано</small>
              </button>
              <button className="role-choice role-choice-disabled" disabled>
                <UserRound className="w-9 h-9 text-cyan-200" />
                <span>За человека</span>
                <small>Пока не реализовано</small>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
