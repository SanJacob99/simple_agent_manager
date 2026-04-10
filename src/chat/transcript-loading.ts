import type { TranscriptStatus } from '../store/session-store';

interface TranscriptLoadingState {
  isBlocked: boolean;
  storageReady: boolean;
  activeTranscriptStatus: TranscriptStatus;
  activeSessionKey: string | null;
  messageCount: number;
}

export function shouldShowTranscriptLoading({
  isBlocked,
  storageReady,
  activeTranscriptStatus,
  activeSessionKey,
  messageCount,
}: TranscriptLoadingState): boolean {
  if (isBlocked) {
    return false;
  }

  if (!storageReady || activeSessionKey === null) {
    return true;
  }

  if (activeTranscriptStatus !== 'loading') {
    return false;
  }

  return messageCount === 0;
}
