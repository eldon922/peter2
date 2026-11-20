import type { Tag } from '@/types';

const tones = {
  default: 'border-primary/30 bg-primary/10 text-primary',
  include:
    'border-green-500/30 bg-green-500/10 text-green-300 in-data-[mode=light]:text-green-800',
  exclude: 'border-red-500/30 bg-red-500/10 text-red-300',
};

export function TagChips({
  tags,
  tone = 'default',
}: {
  tags: Tag[];
  tone?: keyof typeof tones;
}) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-normal ${tones[tone]}`}
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          <span className="min-w-0 wrap-anywhere">{tag.name}</span>
        </span>
      ))}
    </div>
  );
}
