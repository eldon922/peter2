ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS template_header_text TEXT;
