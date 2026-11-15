/**
 * Center-crop and shrink a photo in the browser before uploading (keeps uploads small and
 * strips EXIF metadata like GPS location, since the canvas re-encodes only pixels).
 */
export async function prepareAvatar(file: File, size = 320): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't read that image format. Try a JPEG or PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error("Couldn't read that image. Try another.");
  return blob;
}
