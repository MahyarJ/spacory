export const DEFAULT_PLAN_LABEL_TEXT = "Label";

export function isPlanLabelText(text: string): boolean {
  return text.trim().length > 0 && !/[\r\n]/u.test(text);
}
