export function cn(...values: Array<string | number | false | null | undefined>) {
  return values
    .flatMap((value) => {
      if (typeof value === "string" || typeof value === "number") return String(value);
      return value ? String(value) : [];
    })
    .filter(Boolean)
    .join(" ");
}
