'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

const categoryColors: Record<string, string> = {
  Marketing:
    'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  Authentication:
    'bg-orange-500/10 text-orange-800 dark:text-orange-300 border-orange-500/20',
};

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({
  selectedTemplate,
  onSelect,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('chooseTemplate.errorLoad')
        );
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('chooseTemplate.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="border-border bg-card/50 flex h-48 flex-col items-center justify-center rounded-xl border">
          <FileText className="text-muted-foreground mb-2 h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            {t('chooseTemplate.noTemplates')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('chooseTemplate.createFirst')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            const catColor =
              categoryColors[template.category] ?? categoryColors.Utility;

            return (
              <button
                key={template.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(template)}
                className={`focus-visible:ring-ring flex min-w-0 scroll-mb-48 flex-col gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                    : 'border-border bg-card/50 hover:border-border hover:bg-card'
                }`}
              >
                {/* Meta template names are snake_case with no spaces, so a
                    long one has no natural break point and used to push the
                    category chip out past the card edge. `break-words` lets
                    the name run onto as many lines as it needs, `min-w-0`
                    lets it actually shrink inside the flex row, and the chip
                    holds its size / wraps underneath instead of overflowing. */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-foreground min-w-0 flex-1 text-sm font-medium break-words">
                    {template.name}
                  </h3>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                  >
                    {template.category}
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-3 text-xs">
                  {template.body_text}
                </p>
                <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
                  <span>{template.language ?? 'en_US'}</span>
                  {/* Status is omitted on purpose — every template
                      shown here is already filtered to APPROVED,
                      so the chip carried no information. */}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="border-border bg-background sticky bottom-0 z-10 mt-auto flex items-center justify-between gap-4 border-t py-4">
        <Button variant="outline" onClick={onBack} className="h-10 px-4">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate}
          className="h-10 px-5"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
