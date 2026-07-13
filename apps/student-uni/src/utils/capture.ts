import { capabilities } from './runtime';

type CaptureApi = {
  setVisualEffectOnCapture?: (options: {
    visualEffect: 'hidden' | 'none';
    success?: () => void;
    fail?: () => void;
  }) => void;
};

function captureApi(): CaptureApi | null {
  if (!capabilities.captureProtection) return null;
  return ((globalThis as unknown as { wx?: CaptureApi }).wx ?? null);
}

export function enableCaptureProtection(): void {
  captureApi()?.setVisualEffectOnCapture?.({ visualEffect: 'hidden' });
}

export function disableCaptureProtection(): void {
  captureApi()?.setVisualEffectOnCapture?.({ visualEffect: 'none' });
}
