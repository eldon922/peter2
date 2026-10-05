"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";

interface TagPickerListProps {
  tags: Tag[];
  value: string[];
  onToggle: (tagId: string) => void;
}

/** Search box + checkbox list. Reused wherever a tag has to be picked. */
export function TagPickerList({ tags, value, onToggle }: TagPickerListProps) {
  const t = useTranslations("TagPicker");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tags.filter((tag) => tag.name.toLowerCase().includes(q)) : tags;
  }, [tags, query]);

  return (
    <div>
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-8 border-border bg-muted pl-7 text-foreground"
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          {t("noMatch")}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto py-1">
          {visible.map((tag) => (
            <label
              key={tag.id}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/50"
            >
              <Checkbox
                checked={value.includes(tag.id)}
                onCheckedChange={() => onToggle(tag.id)}
                aria-label={tag.name}
              />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="truncate text-sm text-popover-foreground">
                {tag.name}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface TagMultiSelectProps extends TagPickerListProps {
  onClear?: () => void;
  placeholder?: string;
  /** `danger` tints the selected chips red (used for exclusion lists). */
  variant?: "default" | "danger";
  disabled?: boolean;
  className?: string;
}

/**
 * Searchable multi-select dropdown. Selected tags show as removable chips;
 * the trigger opens a popover with a search box and checkbox list.
 */
export function TagMultiSelect({
  tags,
  value,
  onToggle,
  onClear,
  placeholder,
  variant = "default",
  disabled,
  className,
}: TagMultiSelectProps) {
  const t = useTranslations("TagPicker");
  const selected = tags.filter((tag) => value.includes(tag.id));

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1.5",
        disabled && "opacity-50",
        className,
      )}
    >
      {selected.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            variant === "danger"
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-primary/30 bg-primary/10 text-primary",
          )}
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
          <button
            type="button"
            onClick={() => onToggle(tag.id)}
            disabled={disabled}
            aria-label={t("remove", { name: tag.name })}
            className="hover:opacity-70"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      <Popover>
        <PopoverTrigger
          disabled={disabled}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {selected.length === 0 ? (placeholder ?? t("placeholder")) : t("add")}
          <ChevronDown className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 max-w-[calc(100vw-2rem)] gap-0 p-0"
        >
          <TagPickerList tags={tags} value={value} onToggle={onToggle} />
          {onClear && value.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              {t("clear")}
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
