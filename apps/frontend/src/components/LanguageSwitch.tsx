import { LOCALES, LOCALE_LABELS } from '@cruise/i18n';
import { t } from '@/lib/i18n';
import { useUi } from '@/store/ui';

export function LanguageSwitch() {
  const { language, setLanguage } = useUi();
  return (
    <div role="group" aria-label={t('Language')} className="flex overflow-hidden rounded-md border border-border">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={language === l}
          onClick={() => setLanguage(l)}
          className={`px-2 py-1 text-xs font-medium ${language === l ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          title={LOCALE_LABELS[l]}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
