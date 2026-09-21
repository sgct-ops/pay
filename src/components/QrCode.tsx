"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * The QR itself. Rendered to a canvas so it can be saved as a PNG and sent to
 * whoever is doing the paying, and drawn locally so nothing about the payout
 * leaves the device to make a picture of it.
 */
export function QrCode({
  value,
  size = 232,
  disabled,
  canvasRef,
}: {
  value: string;
  size?: number;
  disabled?: boolean;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}) {
  const localRef = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? localRef;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (disabled || !value) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1d1f23", light: "#ffffff" },
    })
      .then(() => setError(null))
      .catch((e: Error) => setError(e.message));
  }, [value, size, disabled, ref]);

  return (
    <div
      className="grid place-items-center rounded-lg border border-line bg-white"
      style={{ width: size + 18, height: size + 18 }}
    >
      {disabled || !value ? (
        <span className="px-4 text-center text-[12px] leading-relaxed text-ink-3">
          Add a UPI ID and a note to build the QR
        </span>
      ) : error ? (
        <span className="px-4 text-center text-[12px] text-clay">{error}</span>
      ) : (
        <canvas ref={ref} width={size} height={size} />
      )}
    </div>
  );
}
