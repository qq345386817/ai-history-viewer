import type { Message, Session } from "../shared/types.js";

// Image payloads stay on the server; detail responses contain only media URLs.
export interface StoredMessage extends Message {
  imageSources?: Record<string, string>;
  generatedImage?: boolean;
}
export interface StoredSession extends Omit<Session, "messages"> {
  messages: StoredMessage[];
}
