import type { ChalkInstance } from 'chalk';
import type { AnthropicClient } from './api/client.js';

// Extend the global namespace to add the isDebugMode property
declare global {
  var isDebugMode: boolean;
}

// Message role types
export type MessageRole = 'user' | 'assistant';

// Message object structure
export interface Message {
  role: MessageRole;
  content: string;
  agentId: string | null;
  agentName: string | null;
  agentRole: string | null;
  timestamp: number;
}

// Usage information returned from API
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

// Model price information
export interface ModelPrice {
  input: number;
  output: number;
}

// Pricing structure for different models
export interface ModelPricing {
  [modelName: string]: ModelPrice;
}

// Cost estimate returned from calculateCost
export interface CostEstimate {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputCost: string | number;
  outputCost: string | number;
  totalCost: string | number;
  disclaimer?: string;
}

// Options for withRetryLogic
export interface RetryOptions<T> {
  retryDelay?: number;
  onRetry?: (error: Error) => void;
  fallbackFn?: (error: Error) => Promise<T>;
}

// API Error with status
export interface ApiError extends Error {
  status?: number;
}

// Agent configuration options
export interface AgentOptions {
  agentId: string;
  name: string;
  persona: string;
  role: string;
  color: ChalkInstance;
  client: AnthropicClient;
  lowEndModel?: string;
  highEndModel?: string;
  maxTokens?: number;
}

// Meeting simulator options
export interface MeetingSimulatorOptions {
  client: AnthropicClient;
  agenda: string[];
  userInvolvement: string;
  lowEndModel: string;
  highEndModel: string;
  meetingPurpose: string;
  personas: PersonaDirectory;
}

// Personas structure
export interface PersonaInfo {
  name: string;
  role: string;
  persona: string;
  description: string;
  color: ChalkInstance;
}

// Available personas dictionary
export interface PersonaDirectory {
  [id: string]: PersonaInfo;
}

// Moderator agent options
export interface ModeratorOptions {
  client: AnthropicClient;
  agenda: string[];
  availablePersonas: PersonaDirectory;
  lowEndModel?: string;
  highEndModel?: string;
  meetingPurpose?: string;
}
