"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/** The internal bitmap size. Rendered once, then scaled down by CSS if needed. */
const RESOLUTION = 480;

/**
 * The QR itself. Drawn locally — nothing about the payout leaves the device to
 * make a picture of it — and onto a canvas so it can be saved as a PNG and sent
 * to whoever is doing the paying.
 *
 * `fluid` renders it to fill whatever box it is given, which is what lets the
 * phone layout give the QR all the room left over and still fit one screen.
 */
export function QrCode({
  value,
  size = 232,
  fluid = false,
  disabled,
  canvasRef,
}: {
  value: string;
  size?: number;
  fluid?: boolean;
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
      width: RESOLUTION,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1d1f23", light: "#ffffff" },
    })
      .then(() => setError(null))
      .catch((e: Error) => setError(e.message));
  }, [value, disabled, ref]);

  // Fluid mode lets the canvas keep its own square aspect and simply clamps it
  // with max-width/max-height. Percentage heights on a replaced element inside
  // an auto-sized track resolve unpredictably and crop the code.
  // max-w-full on both shell and canvas in fixed mode too: the inline width is
  // a preferred size, not a licence to push out of a narrow column. Without it
  // a fixed 242px box in a tighter track simply overflows its container.
  const shell = fluid
    ? "flex aspect-square h-full max-w-full items-center justify-center rounded-xl border border-line bg-white p-2"
    : "grid max-w-full place-items-center rounded-lg border border-line bg-white";

  return (
    <div className={shell} style={fluid ? undefined : { width: size + 18, height: size + 18 }}>
      {disabled || !value ? (
        <span className="px-4 text-center text-[12px] leading-relaxed text-ink-3">
          Nothing to build a QR from yet
        </span>
      ) : error ? (
        <span className="px-4 text-center text-[12px] text-clay">{error}</span>
      ) : (
        <canvas
          ref={ref}
          width={RESOLUTION}
          height={RESOLUTION}
          className={
            fluid ? "h-full max-h-full w-auto max-w-full object-contain" : "h-auto max-w-full"
          }
          style={fluid ? undefined : { width: size, height: size }}
        />
      )}
    </div>
  );
}
