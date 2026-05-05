import { ArrowLeft } from 'lucide-react';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './types';
import ProvidersApiKeysSection from './sections/ProvidersApiKeysSection';
import ModelCatalogSection from './sections/ModelCatalogSection';
import DefaultsSection from './sections/DefaultsSection';
import AppearanceSection from './sections/AppearanceSection';
import ColorsSection from './sections/ColorsSection';
import DataMaintenanceSection from './sections/DataMaintenanceSection';
import SafetySection from './sections/SafetySection';
import SamAgentSection from './sections/SamAgentSection';

interface SettingsWorkspaceProps {
  activeSection: SettingsSectionId;
  onExit: () => void;
}

export default function SettingsWorkspace({
  activeSection,
  onExit,
}: SettingsWorkspaceProps) {
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === activeSection);

  if (!section) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            {section.label}
          </h2>
          <p className="text-sm text-slate-400">{section.description}</p>
        </div>
        <button
          onClick={onExit}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          <ArrowLeft size={16} />
          Return to Canvas
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {activeSection === 'api-keys' ? (
          <ProvidersApiKeysSection />
        ) : activeSection === 'model-catalog' ? (
          <ModelCatalogSection />
        ) : activeSection === 'defaults' ? (
          <DefaultsSection />
        ) : activeSection === 'sam-agent' ? (
          <SamAgentSection />
        ) : activeSection === 'safety' ? (
          <SafetySection />
        ) : activeSection === 'appearance' ? (
          <AppearanceSection />
        ) : activeSection === 'colors' ? (
          <ColorsSection />
        ) : activeSection === 'data-maintenance' ? (
          <DataMaintenanceSection />
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
            Section content placeholder for {section.label}
          </div>
        )}
      </div>
    </div>
  );
}
