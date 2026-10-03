/*!
 * Create menu adapted from Bencho — https://bencho.dev/licence
 * MIT License
 * Copyright (c) 2026 Lorenzo Cabra
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { School, Folder, Plus } from "lucide-react";

/* ══ Liquid ═══════════════════════════════════════════════
   Three metaball studies: a toggle, a reorderable list, and
   a create menu.

   RECONSTRUCTED. The original file was destroyed; this is
   rebuilt against the surviving stylesheet, which specifies
   the geometry, the layering and the timing exactly. The
   behaviour matches what index.css and the catalog demos
   require. The original's internal reasoning is not
   recoverable and is not reproduced here.

   ── the shared constraint ───────────────────────────────
   Everything on a filtered layer must be OPAQUE. The goo
   filter thresholds alpha, so a translucent fill under it
   disappears. That is why each of these has two layers: an
   opaque blob layer that carries the filter, and an unfiltered
   layer above it carrying the text — antialiased type would
   be eaten by the same threshold. */

/* ── inlined from lab/motionkit ──────────────────────── */
/* ══ liquid ═══════════════════════════════════════════════
   Shared parts for the Framer Motion layer: one spring, one
   goo filter, one velocity→skew binding.

   ── why the filter is a hook ────────────────────────────
   The filter is embedded in each component's own return, but
   its id CANNOT be a literal. Every block here renders twice
   at once — once in the wall card, once in the detail overlay
   — and duplicate SVG ids do not scope, they collide: the
   second instance silently steals the first one's filter.
   useId() gives each mount its own name.

   ── what the goo can and cannot do ──────────────────────
   This is feGaussianBlur + feColorMatrix, not a shader. The
   matrix multiplies alpha by `cut` and subtracts half of it,
   so alpha below 0.5 lands on zero and everything above 0.536
   is fully opaque. That hard edge is what fuses nearby shapes
   into one blob — and it is also why this must never touch
   text: glyph antialiasing lives entirely below 0.5, so type
   under this filter loses its edges and then itself. */

/* the elastic, as specified: ζ = 14 / (2·√(220·0.5)) ≈ 0.67,
   so it overshoots about 6% before it settles. A deliberate
   bounce, not a wobble. */
const LIQUID = {
  type: "spring" as const,
  stiffness: 220,
  damping: 14,
  mass: 0.5,
};

/* Non-drag blocks reuse the same feel without the overshoot,
   so a toggle does not bounce like a dragged card. */
/* ── the same liquid, without the overshoot ────────────────
   For shapes whose corner radius is animating: a spring that
   passes its target drags the radius past it too, and corners
   that dip under and come back read as a wobble rather than
   as a bounce.

   NOT just LIQUID with more damping, which is what this was.
   Raising damping alone to 30 against the same stiffness put
   ζ at 1.43 — comfortably overdamped, so it stopped
   overshooting by creeping: about 470ms to settle, against
   LIQUID's 290ms. It read as slow because it was.

   Stiffness comes up with the damping instead, which holds ζ
   at 1.03 — no overshoot, and it lands in about 180ms. */
const LIQUID_STILL = { ...LIQUID, stiffness: 420, damping: 30 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ══ 3 · Create ═══════════════════════════════════════════
   One shape, and no filter on it — the other studies fuse two
   or more shapes, this has exactly one, so a blur could only
   damage it. The liquid here is entirely in the timing: the
   press sinks, and the spread starts while the sink is still
   running so there is never a still frame.

   The pill's width is measured from its own label and written
   back as --pill-w, so the label can change without the shape
   jumping. */

const ITEMS = [
  { icon: School, label: "新建班级" },
  { icon: Folder, label: "新建班级组" },
];

/* ── the menu's corners, and there are three ───────────────
   The panel is 28, the rows inside it are cut to 28 less the
   10px inset — concentric, which is what makes a row look like
   it belongs in the panel rather than merely sitting in one —
   and the shut pill is a 38px button, so 19 is round for it.

   One knob moves all three because they are one relationship:
   turn it down and the panel, the pill and the rows square off
   together. Each is capped at half its own height, past which
   a bigger number draws the same shape. */
const CRT_CORNER = 28;
const CRT_MAX = 40;

type CreateMenuProps = { classroomUrl: string; groupUrl: string; corner?: number };

export function CreateMenu({ classroomUrl, groupUrl, corner = CRT_CORNER }: CreateMenuProps) {
  const menuId = useId();
  const reducedMotion = useReducedMotion();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const firstItem = useRef(0);
  const [stageW, setStageW] = useState(108);
  const [open, setOpen] = useState(false);
  const [sink, setSink] = useState(false);

  const panel = useRef<HTMLDivElement | null>(null);
  const say = useRef<HTMLSpanElement | null>(null);
  const beat = useRef(0);

  const [sayW, setSayW] = useState(25);
  /* ── MEASURE TWICE: ONCE NOW, ONCE THE FONT IS REAL ────────
     .crt-say clips whatever it cannot fit, so this width being
     even slightly short takes the right edge off the last
     letter — and it was short two different ways.

     The rounding: offsetWidth is an integer and the label is
     not. "Create" measures 42.46 and comes back 42. The +1 is
     the fix; the error is always under a pixel so a pixel
     always covers it, and the pill is centred on the label so
     the spare costs nothing.

     The race, which is the one that made it intermittent: a
     layout effect runs before a webfont has swapped in, so on
     a cold cache this measured "Create" in the FALLBACK face
     and then froze that number for good. Warm cache measured
     Inter and looked fine — same code, different result, which
     is why it only cut the word sometimes. So measure again
     when the fonts are actually ready. */
  useLayoutEffect(() => {
    const el = say.current;
    if (!el) return;
    let live = true;
    const measure = () => { if (live) setSayW(el.offsetWidth + 1); };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(beat.current);
  }, []);

  /* No close button and no title bar — anywhere but the menu
     puts it away. Registered only while it is open, and in an
     effect, so the very press that opened it cannot close it
     on the same click. */
  useEffect(() => {
    if (!open && !sink) return;
    const away = (e: PointerEvent) => {
      /* ── a press by SOMEBODY, not by the page ─────────────
         This listens on the document, so it hears every press
         anywhere — including the ones other components'
         demonstrations dispatch at themselves. One component
         performing is harmless; several at once are not. On a
         page showing six of them side by side this menu was
         opened by its own demonstration and then slammed shut
         a moment later by a neighbour's, and the rest of its
         script went on clicking a row that was no longer
         there.

         "Anywhere but the menu puts it away" was always about
         a person reaching past it. A scripted press on another
         component is not somebody deciding to leave. */
      if (!e.isTrusted || trigger.current?.contains(e.target as Node)) return;
      /* ── ASK THE VISIBLE BOX, NOT THE RESERVED ONE ───────
         This used to be panel.current.contains(target), and
         `panel` is the STAGE — the square this block reserves
         so that opening the menu does not resize the card
         under it. The stage is 305x305; the menu it holds is
         265x208. Everything in between is stage, so every
         press in it counted as a press on the menu and did
         nothing: measured at 48px of dead ground above the
         panel and 49 below, which is why closing it meant
         clicking well clear of the block rather than just off
         the menu.

         Hit-tested against the panel's own rectangle instead.
         Geometry rather than containment, because the thing
         that must be hit is smaller than the element the ref
         points at and there is no node covering only it — the
         liquid body is painted, not laid out.

         The rect is read per press rather than kept, since it
         is a different size on every frame of the open. */
      const box = panel.current
        ?.querySelector(".crt-panel")
        ?.getBoundingClientRect();
      const on =
        !!box &&
        e.clientX >= box.left && e.clientX <= box.right &&
        e.clientY >= box.top && e.clientY <= box.bottom;
      if (!on || !open) {
        window.clearTimeout(beat.current);
        setSink(false);
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, sink]);

  const press = (index = 0) => {
    firstItem.current = index;
    setSink(true);
    window.clearTimeout(beat.current);
    /* 60ms handoff against a 120ms sink: the spread begins
       while the press is still running. It was 95, which is
       most of the sink — long enough to read as a pause before
       anything opened. */
    beat.current = window.setTimeout(() => {
      setSink(false);
      setOpen(true);
    }, reducedMotion ? 0 : 60);
  };

  /* glyph + gap + label + the padding either side */
  /* Adaptation: keep the existing homepage 108 × 34px button
     and 12px type, while retaining the measured-label geometry. */
  const pillW = Math.max(108, 18 + 7 + sayW + 24);
  const pillH = 34;
  const panelW = 212;
  const panelH = 22 + ITEMS.length * 34 + (ITEMS.length - 1) * 2;

  /* the two the animation needs as NUMBERS — Framer writes
     borderRadius inline, so it cannot read a css variable */
  const panelR = clamp(corner, 0, CRT_MAX);
  const shutR = Math.min(pillH / 2, panelR * (pillH / 2 / CRT_CORNER));


  // Observe the reserved button, not the expanding body. Mobile keeps
  // the existing full-width action without moving the search field.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const measure = () => setStageW(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sayW]);

  useLayoutEffect(() => {
    if (open) panel.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')[firstItem.current]?.focus({ preventScroll: true });
  }, [open]);

  const dismiss = () => {
    window.clearTimeout(beat.current);
    setSink(false);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open && !sink) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, sink]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') { dismiss(); return; }
    if (event.key === ' ') {
      event.preventDefault();
      (document.activeElement as HTMLAnchorElement)?.click();
      return;
    }
    const rows = Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
    let index = rows.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === 'ArrowDown') index = (index + 1) % rows.length;
    else if (event.key === 'ArrowUp') index = (index - 1 + rows.length) % rows.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = rows.length - 1;
    else return;
    event.preventDefault();
    rows[index]?.focus({ preventScroll: true });
  };

  return (
    <motion.div
      className="crt-stage"
      data-open={open || undefined}
      data-sink={sink || undefined}
      ref={panel}
      style={{
        "--pill-w": `${pillW}px`,
        "--pill-h": `${pillH}px`,
        "--panel-w": `${panelW}px`,
        "--panel-h": `${panelH}px`,
        "--crt-r": `${clamp(corner, 0, CRT_MAX)}px`,
        /* the adapted homepage pill is 34 tall, so 17 is as round as it goes */
        "--crt-shut-r": `${Math.min(pillH / 2, clamp(corner, 0, CRT_MAX) * (pillH / 2 / CRT_CORNER)).toFixed(2)}px`,
        /* concentric: the panel's corner less its 10px inset,
           and no rounder than the 34px row's own half */
        "--crt-row-r": `${Math.min(17, Math.max(0, clamp(corner, 0, CRT_MAX) - 10)).toFixed(2)}px`,
      } as CSSProperties}
    >
      <div className="crt-blobs" aria-hidden="true">
        {/* LIQUID_STILL, not LIQUID. A spring past the target
            takes the corner radius with it — the corners dip
            under 28 and come back, which is a wobble, not a
            bounce. This is the one shape here that must not
            overshoot. */}
        <motion.div
          className="crt-body"
          animate={{
            width: open ? panelW : stageW,
            height: open ? panelH : pillH,
            /* ── from the knob, not from two literals ──────
               Framer writes this inline every frame, so the
               stylesheet's `var(--r)` on .crt-body never gets
               a look in — the CSS variables set on the stage
               reach the ROWS, and this shape has to be told
               separately. Same two numbers the vars carry:
               the panel's own corner, and a 34px pill's half
               when it is shut. */
            borderRadius: open ? panelR : shutR,
          }}
          initial={false}
          transition={reducedMotion ? { duration: 0 } : LIQUID_STILL}
        />
      </div>

      <button type="button" className="crt-pill" ref={trigger}
        onClick={() => press()} aria-expanded={open} aria-haspopup="menu"
        aria-controls={menuId} tabIndex={open ? -1 : 0}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            press(event.key === "ArrowUp" ? ITEMS.length - 1 : 0);
          }
        }}>
        <span className="crt-glyph" aria-hidden="true">
          <Plus size={18} strokeWidth={2} />
        </span>
        <span className="crt-say" style={{ width: sayW || undefined }}>
          <span ref={say}>新建</span>
        </span>
      </button>

      <div className="crt-panel" id={menuId} role="menu" aria-label="创建类型"
        aria-hidden={!open} inert={!open} onKeyDown={navigate}>
        {/* each row lights its own wash — see .crt-item a::before;
            nothing travels between them */}
        <ul className="crt-menu" role="none">
          {ITEMS.map((it, i) => (
            <li
              role="none"
              className="crt-item"
              key={it.label}
              /* tightened with the shell. The last row used to
                 start at 162ms — after a box that now finishes
                 in 180 — so the menu kept arriving for half a
                 second after it had opened. */
              style={{ transitionDelay: open ? `${30 + i * 22}ms` : "0ms" }}
            >
              <a role="menuitem" href={i === 0 ? classroomUrl : groupUrl} tabIndex={-1}
                onClick={() => { setOpen(false); }}>
                <it.icon size={15} strokeWidth={2} />
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}
