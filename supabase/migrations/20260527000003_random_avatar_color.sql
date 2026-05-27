-- Give new users a random avatar_color picked from a wide HSL spectrum.
-- We distribute hues evenly across 360° in 24 steps (every 15°), covering
-- all colour families, so collisions are rare even in small teams.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hues INT[] := ARRAY[0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345];
  chosen_hue INT;
  avatar_color TEXT;
BEGIN
  -- Pick a random hue from the spectrum
  chosen_hue := hues[1 + floor(random() * array_length(hues, 1))::int];
  -- Build an HSL colour with fixed saturation (70%) and lightness (50%) for vivid but not harsh colours
  avatar_color := 'hsl(' || chosen_hue || ', 70%, 50%)';

  INSERT INTO public.profiles (id, email, display_name, avatar_url, avatar_color)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    avatar_color
  );
  RETURN NEW;
END;
$$;
