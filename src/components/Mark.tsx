/** The CarbonTree mark — a leaf cut from a coin. Drawn, not an asset. */
export function Mark({ size = 28, tone = "#2f6b4f" }: { size?: number; tone?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="CarbonTree"
      fill="none"
    >
      <circle cx="24" cy="24" r="22" fill={tone} />
      <path
        d="M33.5 13.8c0 10.2-5.4 16.4-13.7 17.3-2 .2-3.6.1-4.9-.2.6-4.2 2.4-7.4 5.4-9.7 2.3-1.7 4.7-2.7 7.3-3.1-3.5-.2-6.6.6-9.3 2.4-3.9 2.6-6.1 6.7-6.6 12.2l-.3 3.9a1.4 1.4 0 1 0 2.8.2l.2-2.6c1.6.4 3.5.6 5.8.4 5-.5 8.9-2.6 11.5-6.2 2.4-3.3 3.6-7.7 3.6-13.1a1.4 1.4 0 0 0-1.8-1.5Z"
        fill="#faf7f0"
      />
    </svg>
  );
}
