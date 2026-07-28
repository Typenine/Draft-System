import Image from "next/image";

export default function AvatarRing({
  src,
  alt,
  size = 36,
  ringColor,
}: {
  src: string;
  alt: string;
  size?: number;
  ringColor?: string; // e.g. "var(--accent)" or team color
}) {
  const ring = ringColor ?? "var(--accent)";
  const style: React.CSSProperties = {
    boxShadow: `0 0 0 2px ${ring}, 0 0 0 4px var(--surface)`,
    borderRadius: "9999px",
  };
  return (
    <span style={style} className="inline-flex">
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="rounded-full"
      />
    </span>
  );
}
