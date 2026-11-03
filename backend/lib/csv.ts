export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^\s*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
