"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "./ui";

export interface CapturedImage {
  name: string;
  type: "image/jpeg";
  dataBase64: string;
}

/**
 * Webcam capture dialog — the registrar/admin shoots the student photo (or
 * a guardian's ID document) straight from the browser. Uses getUserMedia,
 * so it works on any laptop/desktop with a camera and on phones; requires
 * a secure context (https or localhost).
 *
 * Flow: live preview → 📸 Capture → review → Use photo / Retake.
 */
export function WebcamCaptureModal({ title = "Take a photo", onCapture, onClose }: {
  title?: string;
  onCapture: (image: CapturedImage) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null); // data URL under review

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Start (or restart after a retake) the camera stream.
  const startStream = useCallback(async () => {
    setError(null);
    setReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setReady(true);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow camera permission for this site and try again."
          : name === "NotFoundError"
            ? "No camera was found on this device. Plug in a webcam or upload a file instead."
            : "Could not start the camera — upload a file instead.",
      );
    }
  }, []);

  useEffect(() => {
    void startStream();
    return stopStream;
  }, [startStream, stopStream]);

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setShot(canvas.toDataURL("image/jpeg", 0.88));
    stopStream(); // freeze — the review image is shown instead
  }

  function usePhoto() {
    if (!shot) return;
    onCapture({
      name: `webcam-${Date.now()}.jpg`,
      type: "image/jpeg",
      dataBase64: shot.slice(shot.indexOf(",") + 1),
    });
    onClose();
  }

  async function retake() {
    setShot(null);
    await startStream();
  }

  return (
    <Modal open title={title} onClose={() => { stopStream(); onClose(); }} wide>
      <div className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">{error}</div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-slate-950">
            {shot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot} alt="Captured preview" className="mx-auto max-h-[50vh] w-auto" />
            ) : (
              <video ref={videoRef} playsInline muted className="mx-auto max-h-[50vh] w-auto" />
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => { stopStream(); onClose(); }}>Cancel</Button>
          {shot ? (
            <>
              <Button variant="secondary" onClick={() => void retake()}>↺ Retake</Button>
              <Button onClick={usePhoto}>✓ Use photo</Button>
            </>
          ) : (
            <Button onClick={capture} disabled={!ready || !!error}>📸 Capture</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
