import { useState } from 'react';
import { registerUser, loginUser } from '../lib/auth';
import { Loader2 } from 'lucide-react';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = mode === 'login'
        ? await loginUser(username, password)
        : await registerUser(username, password);

      if (result.success) {
        onAuthSuccess();
      } else {
        setError(result.error || 'Произошла ошибка');
      }
    } catch {
      setError('Произошла неизвестная ошибка');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[#050505] text-[#A3A3A3] w-full h-screen font-mono flex items-center justify-center relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      {/* Animated scan lines */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 4px)',
      }}></div>

      <div className="w-full max-w-sm p-6 relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-red-600 animate-pulse"></div>
            <h1 className="text-2xl font-bold tracking-tighter text-white uppercase">PROJECT: Z</h1>
            <div className="w-3 h-3 rounded-full bg-red-600 animate-pulse"></div>
          </div>
          <div className="text-[10px] text-[#555] uppercase tracking-[0.3em]">
            Outbreak Simulation Terminal v1.99
          </div>
          <div className="w-full h-px bg-gradient-to-r from-transparent via-red-900 to-transparent mt-4"></div>
        </div>

        {/* Auth form */}
        <div className="bg-[#0A0A0A] border border-[#333] p-6">
          <div className="flex mb-6 border border-[#222]">
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors ${
                mode === 'login'
                  ? 'bg-red-950 text-red-400 border-r border-[#222]'
                  : 'bg-[#111] text-[#555] hover:text-[#888] border-r border-[#222]'
              }`}
            >
              Авторизация
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors ${
                mode === 'register'
                  ? 'bg-red-950 text-red-400'
                  : 'bg-[#111] text-[#555] hover:text-[#888]'
              }`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#555]">Идентификатор</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-[#111] border border-[#222] p-2.5 text-xs text-[#E0E0E0] focus:outline-none focus:border-red-900 transition-colors"
                placeholder="operator_01"
                autoComplete="username"
                disabled={isLoading}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#555]">Код Доступа</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#111] border border-[#222] p-2.5 text-xs text-[#E0E0E0] focus:outline-none focus:border-red-900 transition-colors"
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="text-red-500 text-[10px] uppercase tracking-wider p-2 border border-red-900/50 bg-red-950/20">
                ⚠ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-red-950 border border-red-600 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              {mode === 'login' ? 'Войти в систему' : 'Создать аккаунт'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <div className="text-[9px] text-[#333] uppercase tracking-widest">
            {mode === 'login'
              ? 'Все ключи и настройки сохраняются в профиле'
              : 'Данные хранятся локально на вашем устройстве'}
          </div>
        </div>
      </div>
    </div>
  );
}
