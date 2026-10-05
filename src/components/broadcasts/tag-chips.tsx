import type { Tag } from '@/types';

export function TagChips({ tags, danger }: { tags: Tag[]; danger?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
            danger
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : 'border-primary/30 bg-primary/10 text-primary'
          }`}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
          {tag.name}
        </span>
      ))}
    </div>
  );
}
