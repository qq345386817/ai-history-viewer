export type Provider = "codex" | "gemini" | "claude";
export const providerNames: Record<Provider, string> = {
  codex: "Codex",
  gemini: "Gemini",
  claude: "Claude",
};

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}
export interface SessionSummary {
  id: string;
  provider: Provider;
  nativeId: string;
  projectId: string;
  projectName: string;
  projectPath: string | null;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  assistantCount: number;
}
export interface Session extends SessionSummary {
  filePath: string;
  messages: Message[];
}
export interface Project {
  id: string;
  name: string;
  path: string | null;
  count: number;
  providerCounts: Partial<Record<Provider, number>>;
  updatedAt: string;
}
export interface SourceStatus {
  provider: Provider;
  root: string;
  available: boolean;
  files: number;
  sessions: number;
  errors: number;
}
export interface Catalog {
  revision: number;
  scanning: boolean;
  scannedAt: string | null;
  sessions: SessionSummary[];
  projects: Project[];
  sources: SourceStatus[];
}
