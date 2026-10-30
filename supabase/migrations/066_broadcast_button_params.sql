ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS template_button_params JSONB
  CHECK (template_button_params IS NULL OR jsonb_typeof(template_button_params) = 'object');
