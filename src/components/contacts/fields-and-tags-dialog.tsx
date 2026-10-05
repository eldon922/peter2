'use client';

import { useTranslations } from 'next-intl';

import { useCan } from '@/hooks/use-can';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CustomFieldsSettings } from './custom-fields-settings';
import { TagManager } from './tag-manager';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Tags and custom fields, managed from the Contacts page. Tags are visible
 * to everyone; the custom-field catalogue is account-wide config, so that
 * card is admin-only (`custom_fields` RLS rejects other writes anyway).
 */
export function FieldsAndTagsDialog({ open, onOpenChange }: Props) {
  const t = useTranslations('Settings.tagsAndFields');
  const canEditSettings = useCan('edit-settings');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('description')}
          </DialogDescription>
        </DialogHeader>
        <TagManager />
        {canEditSettings ? <CustomFieldsSettings /> : null}
      </DialogContent>
    </Dialog>
  );
}
