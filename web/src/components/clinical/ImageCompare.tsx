import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Columns2, Columns3, SplitSquareHorizontal, ZoomIn, ZoomOut, Maximize, MapPin, Circle, MoveUpRight, Hand, Trash2, SunMedium } from 'lucide-react';
import { useImage } from '../../lib/hooks';
import { NoImage } from '.';
import { fmtDate } from '../../lib/format';

export interface Annotation { id: string; imageId: string; kind: string; geometry: any; label?: string | null; color?: string | null; author?: string }
export interface Panel { key: string; title: string; subtitle?: string; imageId?: string | null; quality?: string | null; annotatable?: boolean }
interface Xf { s: number; x: number; y: number }
type Tool = 'pan' | 'pin' | 'circle' | 'arrow';

/**
 * Clinical compare viewer: synced zoom/pan across panels, wipe mode, finding highlight,
 * and annotation tools (pin / circle / arrow) on the current image.
 */
export function ImageCompare({ panels, highlight, annotations, onAnnotate, onDeleteAnnotation, toolbarExtra }: {
  panels: Panel[]; highlight?: { imageId?: string | null; bbox?: { x: number; y: number; w: number; h: number } | null } | null;
  annotations: Annotation[]; onAnnotate?: (imageId: string, kind: string, geometry: any, label?: string) => void; onDeleteAnnotation?: (id: string) => void; toolbarExtra?: ReactNode;
}) {
  const [mode, setMode] = useState<'side' | 'three' | 'wipe'>(panels.length >= 3 ? 'three' : 'side');
  const [xf, setXf] = useState<Xf>({ s: 1, x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>('pan');
  const [wipe, setWipe] = useState(50);
  const [bright, setBright] = useState(false);
  const [pinLabel, setPinLabel] = useState('');

  const current = panels[panels.length - 1];
  const withImg = panels.filter((p) => p.imageId);
  const shown = mode === 'three' ? panels.slice(-3) : mode === 'side' ? panels.slice(-2) : panels.slice(-2);

  // Zoom to a finding's region when highlighted.
  useEffect(() => {
    if (highlight?.bbox) {
      const b = highlight.bbox;
      const s = Math.min(3, Math.max(1.4, 0.6 / Math.max(b.w, b.h)));
      setXf({ s, x: -(b.x + b.w / 2) * s + 0.5, y: -(b.y + b.h / 2) * s + 0.5 });
    } else setXf({ s: 1, x: 0, y: 0 });
  }, [highlight?.bbox?.x, highlight?.bbox?.y, highlight?.imageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f: number) => setXf((t) => { const s = Math.min(6, Math.max(1, t.s * f)); const k = s / t.s; return clampXf({ s, x: 0.5 - (0.5 - t.x) * k, y: 0.5 - (0.5 - t.y) * k }); });

  return (
    <div className="rounded-2xl bg-lightbox overflow-hidden border border-black/40">
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-white/10 text-white/70">
        <ToolBtn active={mode === 'side'} onClick={() => setMode('side')} title="Side by side"><Columns2 className="h-4 w-4" /></ToolBtn>
        {panels.length >= 3 && <ToolBtn active={mode === 'three'} onClick={() => setMode('three')} title="Baseline · previous · current"><Columns3 className="h-4 w-4" /></ToolBtn>}
        <ToolBtn active={mode === 'wipe'} onClick={() => setMode('wipe')} title="Wipe compare" disabled={withImg.length < 2}><SplitSquareHorizontal className="h-4 w-4" /></ToolBtn>
        <Sep />
        <ToolBtn onClick={() => zoom(1.35)} title="Zoom in"><ZoomIn className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={() => zoom(1 / 1.35)} title="Zoom out"><ZoomOut className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={() => setXf({ s: 1, x: 0, y: 0 })} title="Fit"><Maximize className="h-4 w-4" /></ToolBtn>
        <ToolBtn active={bright} onClick={() => setBright(!bright)} title="Brighten for inspection"><SunMedium className="h-4 w-4" /></ToolBtn>
        <span className="num text-2xs text-white/40 w-10 text-center">{Math.round(xf.s * 100)}%</span>
        {onAnnotate && current?.imageId && (
          <>
            <Sep />
            <ToolBtn active={tool === 'pan'} onClick={() => setTool('pan')} title="Pan"><Hand className="h-4 w-4" /></ToolBtn>
            <ToolBtn active={tool === 'pin'} onClick={() => setTool('pin')} title="Pin with note"><MapPin className="h-4 w-4" /></ToolBtn>
            <ToolBtn active={tool === 'circle'} onClick={() => setTool('circle')} title="Circle region"><Circle className="h-4 w-4" /></ToolBtn>
            <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow"><MoveUpRight className="h-4 w-4" /></ToolBtn>
            {tool !== 'pan' && <input value={pinLabel} onChange={(e) => setPinLabel(e.target.value)} placeholder="Label (optional)" className="ml-1 h-7 w-40 rounded-md bg-white/10 border border-white/10 px-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-amber-brand/60" />}
          </>
        )}
        <div className="flex-1" />{toolbarExtra}
      </div>

      {mode === 'wipe' && withImg.length >= 2 ? (
        <WipeView a={withImg[withImg.length - 2]} b={withImg[withImg.length - 1]} xf={xf} setXf={setXf} pos={wipe} setPos={setWipe} bright={bright} />
      ) : (
        <div className={clsx('grid gap-px bg-white/5', shown.length === 3 ? 'grid-cols-3' : shown.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
          {shown.map((p) => (
            <PanelView key={p.key} p={p} xf={xf} setXf={setXf} bright={bright} tool={p === current ? tool : 'pan'}
              highlight={highlight && highlight.imageId && highlight.imageId === p.imageId ? highlight.bbox ?? null : null}
              annotations={annotations.filter((a) => a.imageId === p.imageId)}
              onAnnotate={p === current && onAnnotate && p.imageId ? (k, g) => { onAnnotate(p.imageId!, k, g, pinLabel || undefined); setPinLabel(''); } : undefined}
              onDeleteAnnotation={onDeleteAnnotation} />
          ))}
        </div>
      )}
    </div>
  );
}

const clampXf = (t: Xf): Xf => ({ s: t.s, x: Math.min(0, Math.max(1 - t.s, t.x)), y: Math.min(0, Math.max(1 - t.s, t.y)) });

function useDragPan(setXf: (f: (t: Xf) => Xf) => void) {
  const start = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  return {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); start.current = { px: e.clientX, py: e.clientY, w: r.width, h: r.height }; e.currentTarget.setPointerCapture(e.pointerId); },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      const s = start.current; if (!s) return;
      const dx = (e.clientX - s.px) / s.w, dy = (e.clientY - s.py) / s.h;
      s.px = e.clientX; s.py = e.clientY;
      setXf((t) => clampXf({ ...t, x: t.x + dx, y: t.y + dy }));
    },
    onPointerUp: () => { start.current = null; },
  };
}

function useWheelZoom(ref: React.RefObject<HTMLDivElement>, setXf: (f: (t: Xf) => Xf) => void) {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width, cy = (e.clientY - r.top) / r.height;
      setXf((t) => { const s = Math.min(6, Math.max(1, t.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); const k = s / t.s; return clampXf({ s, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k }); });
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [ref, setXf]);
}

function PanelView({ p, xf, setXf, bright, tool, highlight, annotations, onAnnotate, onDeleteAnnotation }: {
  p: Panel; xf: Xf; setXf: (f: (t: Xf) => Xf) => void; bright: boolean; tool: Tool; highlight: { x: number; y: number; w: number; h: number } | null;
  annotations: Annotation[]; onAnnotate?: (kind: string, g: any) => void; onDeleteAnnotation?: (id: string) => void;
}) {
  const url = useImage(p.imageId);
  const ref = useRef<HTMLDivElement>(null);
  const pan = useDragPan(setXf);
  useWheelZoom(ref, setXf);
  const [draft, setDraft] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const toImg = useCallback((e: RPointerEvent<HTMLDivElement>): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width, sy = (e.clientY - r.top) / r.height;
    return [(sx - xf.x) / xf.s, (sy - xf.y) / xf.s];
  }, [xf]);
  const annotating = tool !== 'pan' && !!onAnnotate;

  const handlers = annotating ? {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => { const pt = toImg(e); if (tool === 'pin') { onAnnotate!('pin', { x: pt[0], y: pt[1] }); return; } setDraft({ a: pt, b: pt }); e.currentTarget.setPointerCapture(e.pointerId); },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => { if (draft) setDraft({ ...draft, b: toImg(e) }); },
    onPointerUp: () => {
      if (draft) {
        const [ax, ay] = draft.a, [bx, by] = draft.b;
        if (Math.hypot(bx - ax, by - ay) > 0.01) onAnnotate!(tool, tool === 'circle' ? { cx: ax, cy: ay, r: Math.hypot(bx - ax, by - ay) } : { x1: ax, y1: ay, x2: bx, y2: by });
        setDraft(null);
      }
    },
  } : pan;

  return (
    <div className="relative bg-lightbox">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 pointer-events-none">
        <span className="text-xs font-semibold text-white bg-black/50 backdrop-blur rounded-md px-2 py-1">{p.title}</span>
        {p.subtitle && <span className="text-2xs text-white/70 bg-black/40 backdrop-blur rounded-md px-1.5 py-1">{p.subtitle}</span>}
        {p.quality && p.quality !== 'usable' && <span className={clsx('text-2xs font-semibold rounded-md px-1.5 py-1', p.quality === 'unusable' ? 'bg-urgent text-white' : 'bg-attention text-white')}>{p.quality}</span>}
      </div>
      <div ref={ref} className={clsx('relative aspect-[4/3] overflow-hidden touch-none select-none', annotating ? 'cursor-crosshair' : xf.s > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')} {...handlers}
        onDoubleClick={() => !annotating && setXf((t) => (t.s > 1 ? { s: 1, x: 0, y: 0 } : clampXf({ s: 2, x: -0.5, y: -0.5 })))}>
        {p.imageId ? (
          <div className="absolute inset-0 origin-top-left will-change-transform" style={{ transform: `translate(${xf.x * 100}%, ${xf.y * 100}%) scale(${xf.s})` }}>
            {url ? <img src={url} alt={p.title} draggable={false} className="h-full w-full object-cover" style={bright ? { filter: 'brightness(1.35) contrast(1.1)' } : undefined} /> : <div className="h-full w-full animate-pulse bg-navy-2" />}
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1 1" preserveAspectRatio="none">
              {highlight && <rect x={highlight.x} y={highlight.y} width={highlight.w} height={highlight.h} fill="rgba(245,180,0,0.08)" stroke="#F5B400" strokeWidth={0.004 / xf.s * 1.5} strokeDasharray={`${0.012 / xf.s} ${0.008 / xf.s}`} rx="0.01" />}
              {annotations.map((a) => <AnnotationShape key={a.id} a={a} s={xf.s} />)}
              {draft && (tool === 'circle'
                ? <circle cx={draft.a[0]} cy={draft.a[1]} r={Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1])} fill="none" stroke="#F5B400" strokeWidth={0.004 / xf.s} />
                : <line x1={draft.a[0]} y1={draft.a[1]} x2={draft.b[0]} y2={draft.b[1]} stroke="#F5B400" strokeWidth={0.004 / xf.s} />)}
            </svg>
            {annotations.filter((a) => a.label).map((a) => {
              const [x, y] = a.kind === 'pin' ? [a.geometry.x, a.geometry.y] : a.kind === 'circle' ? [a.geometry.cx, a.geometry.cy - a.geometry.r] : [a.geometry.x2, a.geometry.y2];
              return <span key={a.id} className="absolute text-[11px] font-medium text-navy bg-amber-brand rounded px-1.5 py-0.5 whitespace-nowrap" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `translate(8px, -120%) scale(${1 / xf.s})`, transformOrigin: 'left bottom' }}>{a.label}</span>;
            })}
          </div>
        ) : <NoImage />}
      </div>
      {annotations.length > 0 && onDeleteAnnotation && (
        <div className="absolute right-2 bottom-2 z-10 flex flex-col gap-1 items-end">
          {annotations.map((a) => (
            <button key={a.id} onClick={() => onDeleteAnnotation(a.id)} className="text-2xs text-white/70 hover:text-white bg-black/50 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
              <Trash2 className="h-3 w-3" />{a.kind}{a.label ? `: ${a.label}` : ''}{a.author ? ` · ${a.author}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotationShape({ a, s }: { a: Annotation; s: number }) {
  const w = 0.005 / s, c = a.color ?? '#F5B400';
  if (a.kind === 'pin') return <g><circle cx={a.geometry.x} cy={a.geometry.y} r={0.012 / s} fill={c} stroke="#10133A" strokeWidth={w * 0.6} /></g>;
  if (a.kind === 'circle') return <circle cx={a.geometry.cx} cy={a.geometry.cy} r={a.geometry.r} fill="none" stroke={c} strokeWidth={w} />;
  const { x1, y1, x2, y2 } = a.geometry; const ang = Math.atan2(y2 - y1, x2 - x1), hl = 0.025 / s;
  return <g stroke={c} strokeWidth={w} strokeLinecap="round"><line x1={x1} y1={y1} x2={x2} y2={y2} /><line x1={x2} y1={y2} x2={x2 - hl * Math.cos(ang - 0.45)} y2={y2 - hl * Math.sin(ang - 0.45)} /><line x1={x2} y1={y2} x2={x2 - hl * Math.cos(ang + 0.45)} y2={y2 - hl * Math.sin(ang + 0.45)} /></g>;
}

function WipeView({ a, b, xf, setXf, pos, setPos, bright }: { a: Panel; b: Panel; xf: Xf; setXf: (f: (t: Xf) => Xf) => void; pos: number; setPos: (n: number) => void; bright: boolean }) {
  const ua = useImage(a.imageId), ub = useImage(b.imageId);
  const ref = useRef<HTMLDivElement>(null);
  const pan = useDragPan(setXf);
  useWheelZoom(ref, setXf);
  const dragging = useRef(false);
  const style = { transform: `translate(${xf.x * 100}%, ${xf.y * 100}%) scale(${xf.s})`, filter: bright ? 'brightness(1.35) contrast(1.1)' : undefined };
  return (
    <div ref={ref} className="relative aspect-[4/3] max-h-[70vh] mx-auto overflow-hidden touch-none select-none cursor-grab" {...pan}>
      <div className="absolute inset-0 origin-top-left" style={style}>{ua && <img src={ua} className="h-full w-full object-cover" draggable={false} alt={a.title} />}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <div className="absolute inset-0 origin-top-left" style={style}>{ub && <img src={ub} className="h-full w-full object-cover" draggable={false} alt={b.title} />}</div>
      </div>
      <span className="absolute left-3 top-3 text-xs font-semibold text-white bg-black/50 rounded-md px-2 py-1">{a.title}{a.subtitle ? ` · ${a.subtitle}` : ''}</span>
      <span className="absolute right-3 top-3 text-xs font-semibold text-white bg-black/50 rounded-md px-2 py-1">{b.title}{b.subtitle ? ` · ${b.subtitle}` : ''}</span>
      <div className="absolute inset-y-0 w-0.5 bg-amber-brand shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: `${pos}%` }}
        onPointerDown={(e) => { e.stopPropagation(); dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!dragging.current) return; const r = ref.current!.getBoundingClientRect(); setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))); }}
        onPointerUp={() => { dragging.current = false; }}>
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-amber-brand text-navy grid place-items-center shadow-pop cursor-ew-resize"><SplitSquareHorizontal className="h-4 w-4" /></span>
      </div>
    </div>
  );
}

function ToolBtn({ children, active, onClick, title, disabled }: { children: ReactNode; active?: boolean; onClick: () => void; title: string; disabled?: boolean }) {
  return <button onClick={onClick} title={title} aria-label={title} disabled={disabled} className={clsx('h-8 w-8 rounded-md grid place-items-center transition disabled:opacity-30', active ? 'bg-white/15 text-white' : 'hover:bg-white/10 hover:text-white')}>{children}</button>;
}
const Sep = () => <span className="mx-1 h-5 w-px bg-white/10" />;
export const panelDate = (s?: string | null) => (s ? fmtDate(s) : undefined);
