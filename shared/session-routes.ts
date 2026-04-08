import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import type { SessionStoreEntry } from './storage-types';

export interface SessionRouteRequest {
  subKey?: string;
  chatType?: SessionStoreEntry['chatType'];
  provider?: string;
  subject?: string;
  room?: string;
  space?: string;
  displayName?: string;
}

export interface SessionRouteResponse {
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;
  created: boolean;
  reset: boolean;
}

export interface SessionTranscriptResponse {
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;
  entries: SessionEntry[];
}
