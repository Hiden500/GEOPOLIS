/** Склейка classNames: отбрасывает пустое, чтобы не плодить `class="a  "`. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
