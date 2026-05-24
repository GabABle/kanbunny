
DROP POLICY IF EXISTS "Board editors can upload card attachments" ON storage.objects;

CREATE POLICY "Board editors can upload card attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-attachments'
  AND auth.uid() IS NOT NULL
  AND public.can_edit_board(
    public.board_of_card(((storage.foldername(name))[1])::uuid),
    auth.uid()
  )
);
