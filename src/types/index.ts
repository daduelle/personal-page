// ============================================================
// MangaREADME Generator — Core Type Definitions
// ============================================================

/** User profile data used to generate manga panels */
export interface UserProfile {
  name: string;
  title?: string;
  bio: string;
  avatar?: string;
  techStack: string[];
  projects: Project[];
  socialLinks?: SocialLinks;
}

export interface Project {
  name: string;
  description: string;
  url?: string;
  techStack?: string[];
}

export interface SocialLinks {
  github?: string;
  twitter?: string;
  linkedin?: string;
  website?: string;
}

// ============================================================
// Manga Style & Layout
// ============================================================

/** Available manga visual styles */
export type MangaStyle =
  | 'shonen'   // Bold, action-oriented (Naruto, One Piece)
  | 'shojo'    // Soft, decorative (Sailor Moon)
  | 'seinen'   // Detailed, realistic (Berserk, Vagabond)
  | 'chibi'    // Cute, super-deformed
  | 'cyberpunk'; // Futuristic tech style (Akira, Ghost in the Shell)

/** Panel layout presets */
export type PanelLayoutType =
  | '2x2'         // Classic 2x2 grid
  | '3x1'         // 3 horizontal panels
  | '1-2-1'       // Hero + 2 side + bottom
  | 'hero'        // One large hero panel
  | 'action'      // Dynamic irregular panels
  | 'comic-strip' // Horizontal strip (3-4 panels)
  | 'profile';    // Profile-focused layout

/** A single manga panel with position, content, and effects */
export interface MangaPanel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  prompt: string;
  imageData?: ImageData;
  imageUrl?: string;
  speechBubble?: SpeechBubble;   // legacy singular bubble (kept for backward compat)
  speechBubbles?: SpeechBubble[]; // new multi-bubble support
  effects?: PanelEffect[];
  label?: string;
  zIndex?: number;
}

/** Speech bubble types and configuration */
export interface SpeechBubble {
  id?: string;
  text: string;
  type: 'speech' | 'thought' | 'shout' | 'narration' | 'whisper';
  position: { x: number; y: number };     // normalized 0-1 relative to panel
  bubbleWidth?: number;                   // normalized fraction of panel width (e.g. 0.45)
  bubbleHeight?: number;                  // normalized fraction of panel height (e.g. 0.28)
  tailDirection?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'none';
  fontSize?: number;
  maxWidth?: number;                      // legacy pixel-based width (still supported)
}

/** Visual effects that can be applied to panels */
export interface PanelEffect {
  type: 'speedlines' | 'screentone' | 'sparkle' | 'impact' | 'halftone' | 'radial-blur' | 'vignette';
  intensity: number; // 0-1
  direction?: number; // degrees
}

// ============================================================
// AI Generation Configuration
// ============================================================

/** Parameters for image generation (sent to any provider) */
export interface GenerationConfig {
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  seed?: number;
  style: MangaStyle;
  negativePrompt?: string;
  strength?: number;
  batchSize?: number;
}

/** Generation status for tracking active generation progress */
export interface GenerationStatus {
  status: 'idle' | 'generating' | 'error';
  currentPanel: number;
  totalPanels: number;
  currentStatus?: string;
  error?: string;
}

// ============================================================
// Provider System (BYOB — Bring Your Own Backend)
// ============================================================

/** Supported image generation providers */
export type ProviderType =
  | 'local-sd'      // Automatic1111 / Forge / SD.Next (local server)
  | 'openai'        // OpenAI DALL-E
  | 'google'        // Google Gemini Image API (Nano Banana)
  | 'stability'     // Stability AI
  | 'replicate'     // Replicate
  | 'huggingface';  // HuggingFace Inference API

/** LoRA configuration for local SD servers */
export interface LoraConfig {
  name: string;
  weight: number; // Typically 0.1 – 1.0
}

/** LoRA info returned from a local SD server */
export interface LoraInfo {
  name: string;
  alias?: string;
  path?: string;
}

/** Full provider connection settings (persisted in store) */
export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  /** Selected checkpoint on a local SD server */
  selectedModel: string;
  /** Active LoRAs for local SD */
  loras: LoraConfig[];
}

/** Live provider connection status */
export interface ProviderStatus {
  connected: boolean;
  checking: boolean;
  error?: string;
  availableModels: string[];
  availableLoras: LoraInfo[];
}

/** Parameters sent to a provider's generateImage method */
export interface GenerateImageParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed?: number;
  signal?: AbortSignal;
  loras?: LoraConfig[];
  model?: string;
}

/** Result returned by a provider after generation */
export interface GenerateImageResult {
  imageDataUrl: string;
  seed?: number;
  metadata?: Record<string, unknown>;
}

/** Interface every image-generation provider must implement */
export interface ImageProvider {
  readonly type: ProviderType;
  readonly displayName: string;

  generateImage(
    params: GenerateImageParams,
    onStatus?: (msg: string) => void,
  ): Promise<GenerateImageResult>;

  checkConnection(): Promise<{ ok: boolean; error?: string }>;
  listModels?(): Promise<string[]>;
  listLoras?(): Promise<LoraInfo[]>;
}

// ============================================================
// WebGPU
// ============================================================

export interface WebGPUStatus {
  supported: boolean;
  available: boolean;
  adapterName?: string;
  adapterVendor?: string;
  architecture?: string;
  deviceDescription?: string;
  maxBufferSize?: number;
  maxComputeWorkgroupSize?: number[];
  features?: string[];
  error?: string;
}

// ============================================================
// Generation Pipeline
// ============================================================

export interface GenerationResult {
  panelId: string;
  imageDataUrl: string;
  width: number;
  height: number;
  prompt: string;
  seed: number;
  timestamp: number;
}

export interface GenerationJob {
  id: string;
  panelId: string;
  prompt: string;
  config: GenerationConfig;
  status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
  progress: number;
  result?: GenerationResult;
  error?: string;
}

// ============================================================
// Export
// ============================================================

export interface ExportConfig {
  format: 'png' | 'markdown' | 'both';
  width: number;
  height: number;
  quality: number;
  includeCredits: boolean;
  fileName?: string;
}

export interface ExportResult {
  dataUrl?: string;
  markdown?: string;
  blob?: Blob;
}

// ============================================================
// App State
// ============================================================

export interface AppState {
  // User data
  userProfile: UserProfile;

  // Generation
  style: MangaStyle;
  layoutType: PanelLayoutType;
  panels: MangaPanel[];
  generationConfig: GenerationConfig;
  jobs: GenerationJob[];

  // Provider (BYOB)
  providerConfig: ProviderConfig;
  providerStatus: ProviderStatus;
  generationStatus: GenerationStatus;

  // WebGPU (informational)
  webgpuStatus: WebGPUStatus;

  // UI
  currentStep: 'input' | 'customize' | 'generate' | 'export';
  isGenerating: boolean;
  showAdvanced: boolean;
}
