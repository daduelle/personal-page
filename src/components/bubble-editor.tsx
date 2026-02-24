'use client';

/**
 * BubbleEditor — Canva-style interactive speech bubble editor.
 *
 * Opens as a full-screen modal overlay. The manga canvas is rendered
 * as a static background (without bubbles). Bubbles are rendered as
 * interactive SVG overlays that can be:
 *   - Dragged to reposition
 *   - Resized via corner handle
 *   - Double-clicked to edit text inline
 *   - Selected to reveal the contextual toolbar
 *   - Added / removed freely
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { renderMangaPage } from '@/lib/canvas-renderer';
import { useAppStore } from '@/store/app-store';
import { CANVAS_DEFAULTS } from '@/lib/constants';
import type { MangaPanel, SpeechBubble } from '@/types';

// ──────────────────────────────────────────────────────────────────────────────
// Internal types
// ──────────────────────────────────────────────────────────────────────────────

type BubbleType = SpeechBubble['type'];
type TailDir = NonNullable<SpeechBubble['tailDirection']>;

interface WorkingBubble {
  id: string;
  panelId: string;
  text: string;
  type: BubbleType;
  /** Center X in canvas coords */
  cx: number;
  /** Center Y in canvas coords */
  cy: number;
  /** Bubble box width in canvas coords */
  bw: number;
  /** Bubble box height in canvas coords */
  bh: number;
  tailDir: TailDir;
  fontSize: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Convert store panels → WorkingBubble[] for the editor */
function panelsToWorkingBubbles(panels: MangaPanel[]): WorkingBubble[] {
  const out: WorkingBubble[] = [];
  for (const panel of panels) {
    const list: SpeechBubble[] =
      panel.speechBubbles && panel.speechBubbles.length > 0
        ? panel.speechBubbles
        : panel.speechBubble
          ? [panel.speechBubble]
          : [];

    for (const b of list) {
      const bw = (b.bubbleWidth ?? 0.42) * panel.width;
      const bh = (b.bubbleHeight ?? 0.26) * panel.height;
      out.push({
        id: b.id ?? uid(),
        panelId: panel.id,
        text: b.text,
        type: b.type,
        cx: panel.x + b.position.x * panel.width,
        cy: panel.y + b.position.y * panel.height,
        bw,
        bh,
        tailDir: b.tailDirection ?? 'bottom-left',
        fontSize: b.fontSize ?? 14,
      });
    }
  }
  return out;
}

/** Convert WorkingBubble[] back into updated panels */
function workingBubblesToPanels(
  panels: MangaPanel[],
  bubbles: WorkingBubble[],
): MangaPanel[] {
  return panels.map((panel) => {
    const panelBubbles = bubbles.filter((b) => b.panelId === panel.id);
    const speechBubbles: SpeechBubble[] = panelBubbles.map((b) => ({
      id: b.id,
      text: b.text,
      type: b.type,
      position: {
        x: clamp((b.cx - panel.x) / panel.width, 0.05, 0.95),
        y: clamp((b.cy - panel.y) / panel.height, 0.05, 0.95),
      },
      bubbleWidth: clamp(b.bw / panel.width, 0.05, 1),
      bubbleHeight: clamp(b.bh / panel.height, 0.05, 1),
      tailDirection: b.tailDir,
      fontSize: b.fontSize,
    }));
    return {
      ...panel,
      speechBubble: undefined,  // clear legacy field
      speechBubbles,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SVG Path Builders
// ──────────────────────────────────────────────────────────────────────────────

function speechPath(
  x: number, y: number, w: number, h: number, tailDir: TailDir,
): string {
  const r = Math.min(16, w / 4, h / 3);
  const tLen = Math.min(28, h * 0.45);
  const tHalf = Math.min(14, w * 0.15);

  const round = `M ${x + r},${y}
    H ${x + w - r} Q ${x + w},${y} ${x + w},${y + r}
    V ${y + h - r} Q ${x + w},${y + h} ${x + w - r},${y + h}`;

  if (tailDir === 'none') {
    return `${round} H ${x + r} Q ${x},${y + h} ${x},${y + h - r} V ${y + r} Q ${x},${y} ${x + r},${y} Z`;
  }

  const isBottom = tailDir.startsWith('bottom');
  const isLeft = tailDir.endsWith('left');

  if (isBottom) {
    const tx = isLeft ? x + w * 0.28 : x + w * 0.72;
    return `${round}
      H ${tx + tHalf} C ${tx + tHalf},${y + h} ${tx - 2},${y + h + tLen} ${tx - 6},${y + h + tLen}
      C ${tx - 10},${y + h + tLen} ${tx - tHalf - 2},${y + h} ${tx - tHalf},${y + h}
      H ${x + r} Q ${x},${y + h} ${x},${y + h - r} V ${y + r} Q ${x},${y} ${x + r},${y} Z`;
  } else {
    const tx = isLeft ? x + w * 0.28 : x + w * 0.72;
    return `M ${x + r},${y}
      H ${tx - tHalf}
      C ${tx - tHalf},${y} ${tx - 10},${y - tLen} ${tx - 6},${y - tLen}
      C ${tx - 2},${y - tLen} ${tx + tHalf + 2},${y} ${tx + tHalf},${y}
      H ${x + w - r} Q ${x + w},${y} ${x + w},${y + r}
      V ${y + h - r} Q ${x + w},${y + h} ${x + w - r},${y + h}
      H ${x + r} Q ${x},${y + h} ${x},${y + h - r} V ${y + r} Q ${x},${y} ${x + r},${y} Z`;
  }
}

function thoughtPath(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const bumps = 10;
  const bumpAmt = Math.min(8, ry * 0.22);

  let d = '';
  for (let i = 0; i < bumps * 2; i++) {
    const angle = (i / (bumps * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 1 - bumpAmt / ry;
    const px = cx + Math.cos(angle) * rx * r;
    const py = cy + Math.sin(angle) * ry * r;
    d += i === 0 ? `M ${px},${py}` : ` L ${px},${py}`;
  }
  return d + ' Z';
}

function shoutPath(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const points = 14;
  const outerRx = w / 2 + 12;
  const outerRy = h / 2 + 12;
  const innerRx = w / 2;
  const innerRy = h / 2;

  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const isOuter = i % 2 === 0;
    const px = cx + Math.cos(angle) * (isOuter ? outerRx : innerRx);
    const py = cy + Math.sin(angle) * (isOuter ? outerRy : innerRy);
    d += i === 0 ? `M ${px},${py}` : ` L ${px},${py}`;
  }
  return d + ' Z';
}

// ──────────────────────────────────────────────────────────────────────────────
// Bubble SVG Element
// ──────────────────────────────────────────────────────────────────────────────

interface BubbleSvgProps {
  bubble: WorkingBubble;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onResizePointerDown: (e: React.PointerEvent<SVGCircleElement>) => void;
  onClick: (e: React.MouseEvent<SVGGElement>) => void;
  onDoubleClick: (e: React.MouseEvent<SVGGElement>) => void;
  onTextChange: (text: string) => void;
}

function BubbleSvgEl({
  bubble, selected, editing,
  onPointerDown, onResizePointerDown, onClick, onDoubleClick, onTextChange,
}: BubbleSvgProps) {
  const { cx, cy, bw, bh, type, tailDir, fontSize, text } = bubble;
  const x = cx - bw / 2;
  const y = cy - bh / 2;

  const pad = 12;
  const strokeColor = selected ? '#2563eb' : '#1a1a1a';
  const strokeW = selected ? 2.5 : 2;

  let shapePath = '';
  let extra: React.ReactNode = null;

  switch (type) {
    case 'speech':
      shapePath = speechPath(x, y, bw, bh, tailDir);
      break;
    case 'thought':
      shapePath = thoughtPath(x, y, bw, bh);
      // Trailing dots
      extra = (
        <>
          <circle cx={x + bw * 0.28} cy={y + bh + 10} r={5.5} fill="white" stroke={strokeColor} strokeWidth={strokeW} />
          <circle cx={x + bw * 0.18} cy={y + bh + 22} r={3.5} fill="white" stroke={strokeColor} strokeWidth={strokeW} />
          <circle cx={x + bw * 0.11} cy={y + bh + 30} r={2} fill="white" stroke={strokeColor} strokeWidth={strokeW} />
        </>
      );
      break;
    case 'shout':
      shapePath = shoutPath(x, y, bw, bh);
      break;
    case 'narration':
      shapePath = `M ${x},${y} H ${x + bw} V ${y + bh} H ${x} Z`;
      // narration double-border inner line
      extra = (
        <rect
          x={x + 4} y={y + 4} width={bw - 8} height={bh - 8}
          fill="none" stroke={strokeColor} strokeWidth={1} opacity={0.4}
          pointerEvents="none"
        />
      );
      break;
    case 'whisper':
      shapePath = `M ${cx},${y} a ${bw/2},${bh/2} 0 1,0 0.01,0 Z`;
      break;
  }

  const foDims = { x: x + pad, y: y + pad, w: bw - pad * 2, h: bh - pad * 2 };

  const fontWeight = type === 'shout' ? 'bold' : type === 'narration' ? 'bold' : 'normal';
  const fontStyle  = type === 'thought' || type === 'whisper' ? 'italic' : 'normal';
  const textColor  = type === 'narration' ? '#1a1a1a' : '#1a1a1a';

  return (
    <g
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ cursor: 'grab' }}
    >
      {/* Main shape */}
      <path
        d={shapePath}
        fill={type === 'narration' ? '#f8f7e8' : 'white'}
        stroke={strokeColor}
        strokeWidth={strokeW}
        strokeDasharray={type === 'whisper' ? '6 4' : undefined}
        filter="drop-shadow(0 2px 4px rgba(0,0,0,0.18))"
      />
      {extra}

      {/* Selection glow ring */}
      {selected && (
        <path
          d={shapePath}
          fill="none"
          stroke="#2563eb"
          strokeWidth={4}
          opacity={0.25}
          pointerEvents="none"
        />
      )}

      {/* Text */}
      <foreignObject
        x={foDims.x} y={foDims.y}
        width={Math.max(1, foDims.w)} height={Math.max(1, foDims.h)}
        pointerEvents={editing ? 'auto' : 'none'}
      >
        {/* @ts-expect-error: xmlns needed for foreignObject */}
        <div xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            boxSizing: 'border-box',
            fontFamily: '"Comic Sans MS", "Bangers", cursive',
            fontSize: `${fontSize}px`,
            fontWeight,
            fontStyle,
            color: textColor,
            textAlign: 'center',
            lineHeight: 1.3,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            cursor: editing ? 'text' : 'inherit',
            outline: 'none',
          }}
          contentEditable={editing}
          suppressContentEditableWarning
          onInput={(e) => onTextChange((e.target as HTMLDivElement).innerText)}
          dangerouslySetInnerHTML={editing ? undefined : { __html: text.replace(/\n/g, '<br/>') }}
        />
      </foreignObject>

      {/* Resize handle (bottom-right) */}
      {selected && (
        <circle
          cx={x + bw} cy={y + bh} r={7}
          fill="#2563eb" stroke="white" strokeWidth={2}
          style={{ cursor: 'se-resize' }}
          onPointerDown={onResizePointerDown}
        />
      )}
    </g>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main BubbleEditor Component
// ──────────────────────────────────────────────────────────────────────────────

interface BubbleEditorProps {
  onClose: () => void;
}

const BUBBLE_TYPES: { type: BubbleType; label: string; emoji: string }[] = [
  { type: 'speech',    label: 'Speech',    emoji: '💬' },
  { type: 'thought',   label: 'Thought',   emoji: '💭' },
  { type: 'shout',     label: 'Shout',     emoji: '💥' },
  { type: 'narration', label: 'Narration', emoji: '📖' },
  { type: 'whisper',   label: 'Whisper',   emoji: '🤫' },
];

const TAIL_DIRS: { dir: TailDir; label: string }[] = [
  { dir: 'bottom-left',  label: '↙' },
  { dir: 'bottom-right', label: '↘' },
  { dir: 'top-left',     label: '↖' },
  { dir: 'top-right',    label: '↗' },
  { dir: 'none',         label: '○' },
];

export function BubbleEditor({ onClose }: BubbleEditorProps) {
  const { panels, setPanels } = useAppStore();

  // ── State ──────────────────────────────────────────────────
  const [bubbles, setBubbles] = useState<WorkingBubble[]>(() =>
    panelsToWorkingBubbles(panels),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string>('');
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  // ── Refs ───────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);

  // ── Render background (canvas without bubbles) ──────────────
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    canvas.width  = CANVAS_DEFAULTS.width;
    canvas.height = CANVAS_DEFAULTS.height;
    renderMangaPage(canvas, panels, {
      showBorders: true,
      showEffects: true,
      showBubbles: false,
    });
    setBgUrl(canvas.toDataURL('image/png'));
  }, [panels]);

  // ── Helpers ────────────────────────────────────────────────
  const selectedBubble = useMemo(
    () => bubbles.find((b) => b.id === selectedId) ?? null,
    [bubbles, selectedId],
  );

  const getSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  const updateBubble = useCallback((id: string, updates: Partial<WorkingBubble>) => {
    setBubbles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    );
  }, []);

  // ── Drag to Move ──────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.PointerEvent<SVGGElement>, bubble: WorkingBubble) => {
      e.stopPropagation();
      if (editingId === bubble.id) return; // don't drag while editing text
      setSelectedId(bubble.id);

      const startSvg = getSvgPoint(e.clientX, e.clientY);
      const startCx = bubble.cx;
      const startCy = bubble.cy;

      const onMove = (ev: PointerEvent) => {
        const cur = getSvgPoint(ev.clientX, ev.clientY);
        updateBubble(bubble.id, {
          cx: startCx + (cur.x - startSvg.x),
          cy: startCy + (cur.y - startSvg.y),
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editingId, getSvgPoint, updateBubble],
  );

  // ── Drag to Resize ─────────────────────────────────────────
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, bubble: WorkingBubble) => {
      e.stopPropagation();
      e.preventDefault();

      const startSvg = getSvgPoint(e.clientX, e.clientY);
      const startBw = bubble.bw;
      const startBh = bubble.bh;

      const onMove = (ev: PointerEvent) => {
        const cur = getSvgPoint(ev.clientX, ev.clientY);
        const dx = cur.x - startSvg.x;
        const dy = cur.y - startSvg.y;
        updateBubble(bubble.id, {
          bw: Math.max(60, startBw + dx * 2),
          bh: Math.max(40, startBh + dy * 2),
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [getSvgPoint, updateBubble],
  );

  // ── Click on bubble ─────────────────────────────────────────
  const handleBubbleClick = useCallback(
    (e: React.MouseEvent, bubble: WorkingBubble) => {
      e.stopPropagation();
      setSelectedId(bubble.id);
    },
    [],
  );

  // ── Double click → enter text editing ──────────────────────
  const handleBubbleDblClick = useCallback(
    (e: React.MouseEvent, bubble: WorkingBubble) => {
      e.stopPropagation();
      setSelectedId(bubble.id);
      setEditingId(bubble.id);
    },
    [],
  );

  // ── Click SVG background → deselect ────────────────────────
  const handleSvgClick = useCallback(() => {
    setSelectedId(null);
    setEditingId(null);
  }, []);

  // ── Add bubble ─────────────────────────────────────────────
  const addBubble = useCallback(
    (type: BubbleType) => {
      if (panels.length === 0) return;
      // Find the panel that currently has the fewest bubbles
      const firstPanel = [...panels].sort((a, b) => {
        const countA = bubbles.filter((bb) => bb.panelId === a.id).length;
        const countB = bubbles.filter((bb) => bb.panelId === b.id).length;
        return countA - countB;
      })[0];

      const newBubble: WorkingBubble = {
        id: uid(),
        panelId: firstPanel.id,
        text: 'Double-click to edit',
        type,
        cx: firstPanel.x + firstPanel.width * 0.5,
        cy: firstPanel.y + firstPanel.height * 0.3,
        bw: firstPanel.width * 0.45,
        bh: firstPanel.height * 0.28,
        tailDir: type === 'narration' ? 'none' : 'bottom-left',
        fontSize: type === 'shout' ? 16 : 14,
      };
      setBubbles((prev) => [...prev, newBubble]);
      setSelectedId(newBubble.id);
      setShowTypeMenu(false);
    },
    [panels, bubbles],
  );

  // ── Delete selected bubble ─────────────────────────────────
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setBubbles((prev) => prev.filter((b) => b.id !== selectedId));
    setSelectedId(null);
    setEditingId(null);
  }, [selectedId]);

  // ── Save & close ──────────────────────────────────────────
  const handleDone = useCallback(() => {
    const updated = workingBubblesToPanels(panels, bubbles);
    setPanels(updated);
    onClose();
  }, [panels, bubbles, setPanels, onClose]);

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) { setEditingId(null); return; }
        onClose();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, editingId, deleteSelected, onClose]);

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────

  const vw = CANVAS_DEFAULTS.width;
  const vh = CANVAS_DEFAULTS.height;

  const portal = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/75 backdrop-blur-sm"
      onClick={handleSvgClick}
    >
      {/* Hidden canvas for background capture */}
      <canvas ref={bgCanvasRef} className="hidden" />

      {/* ── Top toolbar ───────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#1a1a2e] px-5 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 mr-2">
          <span className="font-manga text-base tracking-wider text-white">Bubble Editor</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/50">Beta</span>
        </div>

        <div className="h-5 w-px bg-white/20" />

        {/* Add bubble */}
        <div className="relative">
          <button
            onClick={() => setShowTypeMenu((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5',
              'bg-white/15 text-white text-xs font-bold tracking-wide',
              'hover:bg-white/25 transition-colors border border-white/20',
            )}
          >
            <span className="text-sm">+</span> Add Bubble
          </button>
          {showTypeMenu && (
            <div className="absolute left-0 top-full mt-1 z-10 w-44 rounded-lg border border-white/10 bg-[#16213e] shadow-2xl overflow-hidden">
              {BUBBLE_TYPES.map(({ type, label, emoji }) => (
                <button
                  key={type}
                  onClick={() => addBubble(type)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <span className="text-base">{emoji}</span>
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Per-bubble controls (shown when a bubble is selected) */}
        {selectedBubble && (
          <>
            <div className="h-5 w-px bg-white/20" />

            {/* Bubble type */}
            <div className="flex items-center gap-1">
              {BUBBLE_TYPES.map(({ type, emoji }) => (
                <button
                  key={type}
                  title={type}
                  onClick={() => updateBubble(selectedBubble.id, { type, tailDir: type === 'narration' || type === 'thought' ? 'none' : selectedBubble.tailDir })}
                  className={cn(
                    'rounded px-2 py-1 text-base transition-all',
                    selectedBubble.type === type
                      ? 'bg-white/25 ring-2 ring-blue-400'
                      : 'text-white/60 hover:bg-white/15 hover:text-white',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="h-5 w-px bg-white/20" />

            {/* Font size */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/50 uppercase tracking-widest">Size</span>
              <button
                onClick={() => updateBubble(selectedBubble.id, { fontSize: Math.max(10, selectedBubble.fontSize - 1) })}
                className="rounded bg-white/15 px-2 py-1 text-xs font-bold text-white hover:bg-white/25 transition-colors"
              >A−</button>
              <span className="w-7 text-center text-sm font-bold text-white tabular-nums">
                {selectedBubble.fontSize}
              </span>
              <button
                onClick={() => updateBubble(selectedBubble.id, { fontSize: Math.min(36, selectedBubble.fontSize + 1) })}
                className="rounded bg-white/15 px-2 py-1 text-xs font-bold text-white hover:bg-white/25 transition-colors"
              >A+</button>
            </div>

            {/* Tail direction (only for speech bubbles) */}
            {selectedBubble.type === 'speech' && (
              <>
                <div className="h-5 w-px bg-white/20" />
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-white/50 uppercase tracking-widest mr-1">Tail</span>
                  {TAIL_DIRS.map(({ dir, label }) => (
                    <button
                      key={dir}
                      title={dir}
                      onClick={() => updateBubble(selectedBubble.id, { tailDir: dir })}
                      className={cn(
                        'rounded px-2 py-1 text-sm font-bold transition-all',
                        selectedBubble.tailDir === dir
                          ? 'bg-white/25 text-white ring-2 ring-blue-400'
                          : 'text-white/60 hover:bg-white/15 hover:text-white',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="h-5 w-px bg-white/20" />

            {/* Delete */}
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 bg-red-500/20 text-red-300 text-xs font-bold hover:bg-red-500/35 transition-colors border border-red-500/30"
            >
              <span>🗑</span> Delete
            </button>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Hint text */}
        <span className="hidden text-[11px] text-white/40 lg:block">
          Double-click bubble to edit text · Drag to move · ⌫ to delete
        </span>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="rounded px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          Cancel
        </button>

        {/* Done */}
        <button
          onClick={handleDone}
          className={cn(
            'rounded px-4 py-1.5 text-sm font-bold text-white transition-all',
            'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/40',
          )}
        >
          Done
        </button>
      </div>

      {/* ── Canvas + SVG edit area ────────────────────────── */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-6"
        onClick={(e) => { e.stopPropagation(); handleSvgClick(); }}
      >
        <div
          className={cn(
            'relative overflow-hidden rounded-lg',
            'shadow-[0_0_0_3px_rgba(255,255,255,0.08),0_24px_80px_rgba(0,0,0,0.7)]',
          )}
          style={{
            aspectRatio: `${vw} / ${vh}`,
            maxHeight: '100%',
            maxWidth: '100%',
            height: '100%',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Background manga image */}
          {bgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bgUrl} alt="" className="absolute inset-0 h-full w-full" draggable={false} />
          )}

          {/* SVG editing layer */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${vw} ${vh}`}
            className="absolute inset-0 h-full w-full"
            style={{ cursor: 'default' }}
            onClick={handleSvgClick}
          >
            {bubbles.map((bubble) => (
              <BubbleSvgEl
                key={bubble.id}
                bubble={bubble}
                selected={selectedId === bubble.id}
                editing={editingId === bubble.id}
                onPointerDown={(e) => handleDragStart(e, bubble)}
                onResizePointerDown={(e) => handleResizeStart(e, bubble)}
                onClick={(e) => handleBubbleClick(e, bubble)}
                onDoubleClick={(e) => handleBubbleDblClick(e, bubble)}
                onTextChange={(text) => updateBubble(bubble.id, { text })}
              />
            ))}

            {/* Empty state hint */}
            {bubbles.length === 0 && (
              <text
                x={vw / 2} y={vh / 2}
                textAnchor="middle"
                fontSize={18}
                fill="rgba(255,255,255,0.35)"
                fontFamily="sans-serif"
                pointerEvents="none"
              >
                Click &quot;+ Add Bubble&quot; to start
              </text>
            )}
          </svg>
        </div>
      </div>

      {/* ── Bottom hint bar ───────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-center gap-6 border-t border-white/10 bg-[#1a1a2e]/80 px-5 py-2">
        <span className="text-[11px] text-white/40">Drag to move</span>
        <span className="text-white/20">·</span>
        <span className="text-[11px] text-white/40">Double-click to edit text</span>
        <span className="text-white/20">·</span>
        <span className="text-[11px] text-white/40">Drag corner ● to resize</span>
        <span className="text-white/20">·</span>
        <span className="text-[11px] text-white/40">Delete / ⌫ to remove</span>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(portal, document.body)
    : null;
}
