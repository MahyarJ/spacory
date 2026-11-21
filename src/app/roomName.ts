export const MAX_ROOM_NAME_LENGTH = 80;

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function* graphemes(text: string) {
  // The string iterator keeps surrogate pairs together on older browsers.
  for (const part of segmenter?.segment(text) ?? text) {
    yield typeof part === "string" ? part : part.segment;
  }
}

export function isRoomNameTooLong(name: string): boolean {
  if (name.length <= MAX_ROOM_NAME_LENGTH || !name.trim()) return false;
  let length = 0;
  for (const _ of graphemes(name)) {
    if (++length > MAX_ROOM_NAME_LENGTH) return true;
  }
  return false;
}
