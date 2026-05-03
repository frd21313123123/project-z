import { useState, useEffect } from 'react';
import { Biohazard, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, X, Check } from 'lucide-react';
import type { Scenario } from '../lib/auth';
import menuBackground from '../../background.png';

interface ScenarioSelectScreenProps {
  scenarios: Scenario[];
  selectedScenarioId: string;
  activeScenario: Scenario;
  onSelectScenario: (id: string) => void;
  onAddScenario: () => string;
  onDeleteScenario: (id: string) => void;
  onUpdateScenario: (id: string, field: keyof Scenario, value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function ScenarioSelectScreen({
  scenarios,
  selectedScenarioId,
  activeScenario,
  onSelectScenario,
  onAddScenario,
  onDeleteScenario,
  onUpdateScenario,
  onBack,
  onContinue,
}: ScenarioSelectScreenProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingScenario = scenarios.find(s => s.id === editingId) || null;

  useEffect(() => {
    if (editingId && !scenarios.some(s => s.id === editingId)) {
      setEditingId(null);
    }
  }, [editingId, scenarios]);

  const beginCreateScenario = () => {
    const newId = onAddScenario();
    setEditingId(newId);
  };

  const beginEditScenario = (id: string) => {
    onSelectScenario(id);
    setEditingId(id);
  };

  const detailSections = [
    {
      title: 'Предисловие',
      text: activeScenario.preface,
      empty: 'Предисловие пока не задано.',
    },
    {
      title: 'Начало вируса',
      text: activeScenario.origin,
      empty: 'Начало сценария можно описать в редакторе.',
    },
    {
      title: 'Особенности вируса',
      text: activeScenario.symptoms,
      empty: 'Особенности вируса пока не заданы.',
    },
  ];

  return (
    <section
      className="scenario-selector-screen main-menu-screen relative flex-1 overflow-hidden text-white"
      style={{
        backgroundImage: `url(${menuBackground})`,
      }}
    >
      <div className="menu-hex-grid" />
      <div className="menu-scanline" />

      <div className="absolute left-4 top-4 z-20 text-[10px] uppercase tracking-[0.3em] text-red-100/45">
        Project Z / Scenario Selection
      </div>

      <div className="scenario-radar absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center md:flex">
        <div className="scenario-radar-ring scenario-radar-ring-outer" />
        <div className="scenario-radar-ring scenario-radar-ring-mid" />
        <div className="scenario-radar-core">
          <Biohazard className="h-[18vmin] w-[18vmin] text-red-100/78 drop-shadow-[0_0_38px_rgba(255,180,180,0.9)]" strokeWidth={1.35} />
        </div>
      </div>

      <div className="relative z-10 grid h-full grid-rows-[1fr_auto] px-4 pb-4 pt-16 sm:px-6 lg:px-8">
        <div className="scenario-selection-layout grid min-h-0 gap-5 lg:grid-cols-[minmax(260px,380px)_minmax(0,1fr)]">
          <div className="scenario-list-panel min-h-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.26em] text-red-200/54">База сценариев</div>
                <div className="mt-1 text-sm font-bold uppercase text-white/88">Выбор угрозы</div>
              </div>
              <button className="scenario-small-action" onClick={beginCreateScenario}>
                <Plus className="h-4 w-4" />
                <span>Создать</span>
              </button>
            </div>

            <div className="scenario-list-scroll">
              {scenarios.map((scenario) => {
                const isActive = scenario.id === selectedScenarioId;
                return (
                  <button
                    key={scenario.id}
                    className={`scenario-choice-card ${isActive ? 'scenario-choice-card-active' : ''}`}
                    onClick={() => onSelectScenario(scenario.id)}
                  >
                    <span className="scenario-choice-lines" />
                    <span className="min-w-0 flex-1 text-right">
                      <span className="block truncate text-xl font-bold leading-tight">{scenario.name || 'Без названия'}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-snug text-red-50/66">
                        {scenario.preface || scenario.origin || 'Пользовательский сценарий'}
                      </span>
                    </span>
                    <span className="scenario-choice-icon">
                      <Biohazard className="h-10 w-10" strokeWidth={1.8} />
                    </span>
                    <span
                      className="scenario-choice-edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        beginEditScenario(scenario.id);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="scenario-detail-panel min-h-0">
            <div className="scenario-detail-header">
              <div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-red-200/60">Выбранный сценарий</div>
                <h1>{activeScenario.name || 'Без названия'}</h1>
              </div>
              <button className="scenario-small-action scenario-edit-active" onClick={() => beginEditScenario(activeScenario.id)}>
                <Pencil className="h-4 w-4" />
                <span>Изменить</span>
              </button>
            </div>

            <div className="scenario-detail-scroll">
              {detailSections.map(section => (
                <section key={section.title} className="scenario-detail-section">
                  <h2>{section.title}</h2>
                  <p>{section.text || section.empty}</p>
                </section>
              ))}
            </div>
          </div>
        </div>

        <div className="scenario-bottom-bar scenario-bottom-bar-simple">
          <button className="scenario-nav-button scenario-nav-button-left" onClick={onBack}>
            <ChevronLeft className="h-6 w-6" />
            <span>Назад</span>
          </button>

          <button className="scenario-nav-button scenario-nav-button-right" onClick={onContinue}>
            <span>Продолжить</span>
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </div>

      {editingScenario && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm">
          <div className="scenario-editor w-full max-w-3xl">
            <button
              onClick={() => setEditingId(null)}
              className="absolute right-5 top-5 text-red-100/55 transition-colors hover:text-white"
              aria-label="Закрыть редактор"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="mb-5 pr-10">
              <div className="text-[10px] uppercase tracking-[0.28em] text-red-300/60">Редактор сценария</div>
              <h2 className="mt-2 text-2xl font-bold uppercase tracking-wide text-white">Пользовательский сценарий</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="scenario-editor-field md:col-span-2">
                <span>Название</span>
                <input
                  value={editingScenario.name}
                  onChange={e => onUpdateScenario(editingScenario.id, 'name', e.target.value)}
                  placeholder="Название сценария"
                />
              </label>
              <label className="scenario-editor-field md:col-span-2">
                <span>Предисловие</span>
                <textarea
                  rows={3}
                  value={editingScenario.preface}
                  onChange={e => onUpdateScenario(editingScenario.id, 'preface', e.target.value)}
                  placeholder="Общий контекст: эпоха, страна, тон истории"
                />
              </label>
              <label className="scenario-editor-field">
                <span>Начало</span>
                <textarea
                  rows={6}
                  value={editingScenario.origin}
                  onChange={e => onUpdateScenario(editingScenario.id, 'origin', e.target.value)}
                  placeholder="Где и почему начинается заражение"
                />
              </label>
              <label className="scenario-editor-field">
                <span>Особенности</span>
                <textarea
                  rows={6}
                  value={editingScenario.symptoms}
                  onChange={e => onUpdateScenario(editingScenario.id, 'symptoms', e.target.value)}
                  placeholder="Симптомы, передача, ограничения и правила"
                />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-red-500/25 pt-4">
              <button
                className="scenario-editor-danger"
                onClick={() => onDeleteScenario(editingScenario.id)}
                disabled={scenarios.length <= 1}
              >
                <Trash2 className="h-4 w-4" />
                <span>Удалить</span>
              </button>
              <button className="scenario-editor-save" onClick={() => setEditingId(null)}>
                <Check className="h-4 w-4" />
                <span>Готово</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
