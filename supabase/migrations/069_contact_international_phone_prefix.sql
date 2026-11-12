-- Keep the user-facing international prefix; phone_normalized remains
-- digits-only for identity checks and the unique index.
CREATE OR REPLACE FUNCTION public.format_contact_international_phone()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE digits TEXT;
BEGIN
  digits := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');
  IF digits ~ '^[1-9][0-9]*$' THEN
    NEW.phone := '+' || digits;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS format_international_phone ON public.contacts;
CREATE TRIGGER format_international_phone
  BEFORE INSERT OR UPDATE OF phone ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.format_contact_international_phone();

-- Adding + does not change the normalized identity or phone history.
UPDATE public.contacts SET phone = phone
WHERE phone !~ '^\+'
  AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') ~ '^[1-9][0-9]*$';
