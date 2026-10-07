import type { StimulusTarget } from "./types";

export const GAME_DECK_TOP_RATIO = 0.14;

export interface ResponsiveStimulusGeometryInput {
  width: number;
  height: number;
  targets: Pick<StimulusTarget, "x" | "y">[];
  compactCards?: boolean;
  showReference?: boolean;
  referenceX?: number;
  referenceY?: number;
  deckTopRatio?: number;
  devicePixelRatio?: number;
  targetSize?: "standard" | "diagnostic-large" | "teaching-fill";
}

export interface ResponsiveStimulusGeometryTarget {
  centerX: number;
  centerY: number;
  card: { x: number; y: number; width: number; height: number };
  ring: { x: number; y: number; width: number; height: number };
  label: { x: number; y: number; width: number; height: number };
}

export interface ResponsiveStimulusGeometrySnapshot {
  version: "responsive-geometry-v1";
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  backingWidth: number;
  backingHeight: number;
  targetCount: number;
  cardWidth: number;
  cardHeight: number;
  widthToHeightRatio: number;
  heightToWidthRatio: number;
  ring: number;
  ringX: number;
  ringY: number;
  targets: ResponsiveStimulusGeometryTarget[];
  reference: ResponsiveStimulusGeometryTarget | null;
}

/** Resize threshold shared by StimulusTable's active-run safety guard. */
export function hasSignificantStimulusResize(previous: Pick<ResponsiveStimulusGeometrySnapshot, "cssWidth" | "cssHeight" | "devicePixelRatio"> | null,
  next: Pick<ResponsiveStimulusGeometrySnapshot, "cssWidth" | "cssHeight" | "devicePixelRatio">,
  dimensionThreshold = 8): boolean {
  return Boolean(previous && (Math.abs(previous.cssWidth - next.cssWidth) > dimensionThreshold
    || Math.abs(previous.cssHeight - next.cssHeight) > dimensionThreshold
    || previous.devicePixelRatio !== next.devicePixelRatio));
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/**
 * Resolve all drawable and hit-test geometry from the current CSS container.
 * Existing normalized target positions remain the source of spatial intent;
 * dimensions are reduced when a small/packed container would otherwise cause
 * overlap.  The snapshot is intentionally independent of stimulus timing.
 */
export function computeResponsiveStimulusGeometry(input: ResponsiveStimulusGeometryInput): ResponsiveStimulusGeometrySnapshot {
  const width = Math.max(1, Number.isFinite(input.width) ? input.width : 1);
  const height = Math.max(1, Number.isFinite(input.height) ? input.height : 1);
  const dpr = clamp(Number.isFinite(input.devicePixelRatio ?? 1) ? (input.devicePixelRatio ?? 1) : 1, 0.5, 4);
  // Scale principle targets and their original surrounds together. Cells
  // only constrain placement: they do not stretch the grey flicker surface.
  if (input.targetSize === "teaching-fill" && input.targets.length >= 1 && input.targets.length <= 4 && input.showReference === false) {
    const columns = input.targets.length;
    const rows = 1;
    const edge = Math.min(26, Math.min(width, height) * .025);
    const columnGap = Math.min(28, width * .022);
    const rowGap = Math.min(24, height * .035);
    const cellWidth = (width - 2 * edge - (columns - 1) * columnGap) / columns;
    const cellHeight = (height - 2 * edge - (rows - 1) * rowGap) / rows;
    const labelHeight = Math.min(22, cellHeight * .18);
    const labelGap = Math.min(6, cellHeight * .06);
    const original = computeResponsiveStimulusGeometry({ ...input, targetSize: "standard" });
    const originalSeatWidth = original.cardWidth + original.ringX * 2;
    const originalSeatHeight = original.cardHeight + original.ringY * 2;
    // Reduce two-target views more than three-target views, including when
    // the available space has already limited the shared enlargement budget.
    const countScale = columns === 2 ? .8 : columns === 3 ? .9 : 1;
    const scale = Math.min(1.3, cellWidth / originalSeatWidth,
      (cellHeight - labelHeight - labelGap) / originalSeatHeight) * countScale;
    const cardWidth = original.cardWidth * scale;
    const cardHeight = original.cardHeight * scale;
    const ringX = original.ringX * scale;
    const ringY = original.ringY * scale;
    const seatWidth = originalSeatWidth * scale;
    const seatHeight = originalSeatHeight * scale;
    const targets = input.targets.map((_, index) => {
      const x = edge + (index % columns) * (cellWidth + columnGap) + (cellWidth - seatWidth) / 2;
      const y = edge + Math.floor(index / columns) * (cellHeight + rowGap)
        + (cellHeight - seatHeight - labelGap - labelHeight) / 2;
      return {
        centerX: x + seatWidth / 2, centerY: y + seatHeight / 2,
        card: { x: x + ringX, y: y + ringY, width: cardWidth, height: cardHeight },
        ring: { x, y, width: seatWidth, height: seatHeight },
        label: { x, y: y + seatHeight + labelGap, width: seatWidth, height: labelHeight },
      };
    });
    return { version: "responsive-geometry-v1", cssWidth: width, cssHeight: height, devicePixelRatio: dpr,
      backingWidth: Math.round(width * dpr), backingHeight: Math.round(height * dpr),
      targetCount: input.targets.length, cardWidth, cardHeight,
      widthToHeightRatio: cardWidth / cardHeight, heightToWidthRatio: cardHeight / cardWidth,
      ring: Math.min(ringX, ringY), ringX, ringY, targets, reference: null };
  }
  const rawPositions = input.targets.length ? input.targets : [{ x: 0.5, y: 0.5 }];
  // Keep the six-seat 3x2 meaning while opening the grid slightly around its
  // centre so the enlarged cards use the felt surface more evenly.
  const positions = Boolean(input.compactCards) && rawPositions.length === 6
    ? rawPositions.map((position) => ({
      x: 0.59 + (position.x - 0.59) * 1.15,
      y: 0.51 + (position.y - 0.51) * 1.2,
    }))
    : rawPositions;
  const targetCount = positions.length;
  // `compactCards` identifies the game-table presentation. Keep the teaching
  // stimulus at its established conservative scale while giving the game
  // difficulty layouts their denser 3/4-target composition.
  const compactGameLayout = Boolean(input.compactCards) && targetCount > 2;
  const shortSide = Math.min(width, height);
  const edge = Math.max(10, Math.min(32, shortSide * 0.035));
  const legacySixCardWidth = compactGameLayout && targetCount === 6 ? clamp(width * 0.0935, 104, 156) : 0;
  const legacySixStimulusWidth = legacySixCardWidth * 1.4;
  const legacySixRing = legacySixCardWidth > 0 ? (legacySixStimulusWidth - legacySixCardWidth) / 2 : 0;
  const legacySixStimulusHeight = legacySixCardWidth > 0 ? legacySixCardWidth * (190 / 136) + legacySixRing * 2 : 0;
  const normalizedGap = positions.length > 1
    ? Math.min(...positions.map((position, index) => positions.slice(index + 1).map((other) => Math.hypot((other.x - position.x) * width, (other.y - position.y) * height)).filter(Boolean)).flat())
    : Infinity;
  // Two-target mode retains its previously validated scale. Difficult-mode
  // layouts get their own size budget. Six-target previews have a dedicated
  // budget rather than inheriting the conservative teaching fallback.
  const largeDiagnostic = input.targetSize === "diagnostic-large" && targetCount <= 2;
  const baseCardWidth = targetCount === 2 || largeDiagnostic
    ? largeDiagnostic ? clamp(shortSide * 0.42, 160, 320) : clamp(shortSide * 0.25, 88, 168)
    : compactGameLayout && targetCount === 3
      ? clamp(shortSide * 0.29, 116, 148)
      : compactGameLayout && targetCount === 4
        ? clamp(shortSide * 0.3, 120, 150)
        : compactGameLayout && targetCount === 6
          // Keep the previously validated six-target footprint. The hotfix
          // must restore the card-to-stimulus ratio instead of enlarging the
          // flicker surface to compensate for a constrained canvas height.
          ? clamp(width * 0.0935, 104, 156)
        : clamp(shortSide * 0.22, 64, 112);
  const baseCardHeight = baseCardWidth * (190 / 136);
  const baseRing = targetCount === 2 || largeDiagnostic
    ? largeDiagnostic ? clamp(baseCardWidth * 0.32, 24, 76) : clamp(baseCardWidth * 0.32, 20, 48)
    : compactGameLayout && targetCount === 3
      ? clamp(baseCardWidth * 0.25, 20, 34)
      : compactGameLayout && targetCount === 4
        ? clamp(baseCardWidth * 0.23, 22, 34)
        : compactGameLayout && targetCount === 6
          ? clamp((legacySixStimulusWidth - baseCardWidth) / 2, 8, 30)
        : clamp(baseCardWidth * 0.27, 14, 28);
  const gapFactor = targetCount === 2 ? 0.62 : compactGameLayout && targetCount === 3 ? 0.92 : compactGameLayout && targetCount === 4 ? 0.9 : compactGameLayout && targetCount === 6 ? 0.78 : 0.62;
  const availableByGap = Number.isFinite(normalizedGap) ? Math.max(32, normalizedGap * gapFactor - baseRing * 2) : baseCardWidth;
  const labelHeight = 22;
  const labelGap = 6;
  const minimumRowGap = height >= 800 ? 16 : 10;
  // The six-seat layout has a central reference card as well as a deck in the
  // upper-right. Solve its largest candidate width against the actual
  // rectangles (including labels), rather than relying on paint order or a
  // fixed scale. This also makes the geometry safe for smaller containers.
  const resolvedReferenceY = input.referenceY ?? 0.24;
  const sixSafeWidthLimit = compactGameLayout && targetCount === 6
    ? (() => {
      const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      const fits = (candidate: number) => {
        const candidateHeight = baseCardHeight * (candidate / baseCardWidth);
        const candidateRingX = compactGameLayout && targetCount === 6
          ? Math.max(4, Math.min((legacySixStimulusWidth - candidate) / 2, candidate * 0.2))
          : Math.min(baseRing * (candidate / baseCardWidth), Math.max(8, (shortSide - candidate) * 0.12));
        const candidateRingY = compactGameLayout && targetCount === 6
          ? Math.max(3, Math.min((legacySixStimulusHeight - candidateHeight) / 2, candidate * 0.2))
          : candidateRingX;
        const referenceScale = 0.9;
        const referenceWidth = candidate * referenceScale;
        const referenceHeight = candidateHeight * referenceScale;
        const labelWidthForCandidate = Math.max(48, candidate + candidateRingX * 2);
        const centerFor = (x: number, y: number) => ({
          x: clamp(x * width, edge + candidate / 2 + candidateRingX, width - edge - candidate / 2 - candidateRingX),
          y: clamp(y * height, edge + candidateHeight / 2 + candidateRingY, height - edge - candidateHeight / 2 - candidateRingY - labelHeight),
        });
        const boxes = positions.map((position) => {
          const center = centerFor(position.x, position.y);
          return {
            ring: { x: center.x - candidate / 2 - candidateRingX, y: center.y - candidateHeight / 2 - candidateRingY, width: candidate + candidateRingX * 2, height: candidateHeight + candidateRingY * 2 },
            card: { x: center.x - candidate / 2, y: center.y - candidateHeight / 2, width: candidate, height: candidateHeight },
            label: { x: center.x - labelWidthForCandidate / 2, y: center.y + candidateHeight / 2 + candidateRingY + labelGap, width: labelWidthForCandidate, height: labelHeight },
          };
        });
        const referenceCenter = centerFor(input.referenceX ?? 0.5, resolvedReferenceY);
        const reference = { x: referenceCenter.x - referenceWidth / 2, y: referenceCenter.y - referenceHeight / 2, width: referenceWidth, height: referenceHeight };
        const deckScale = compactGameLayout && targetCount === 6 ? 0.117 : 0.11;
        const deckWidth = Math.max(72, Math.min(119, shortSide * deckScale));
        const deckHeight = deckWidth * (190 / 136);
        const deckEdge = Math.max(18, Math.min(44, shortSide * 0.04));
        const deck = { x: width - deckEdge - deckWidth - 7, y: Math.max(deckEdge, height * (input.deckTopRatio ?? 0.08)) - 7, width: deckWidth + 14, height: deckHeight + 14 };
        const targetCollision = boxes.some((box, index) => boxes.slice(index + 1).some((other) => overlaps(box.ring, other.ring)));
        const referenceCollision = boxes.some((box) => overlaps(box.ring, reference) || overlaps(box.label, reference));
        const labelCollision = boxes.some((box, index) => boxes.some((other, otherIndex) => index !== otherIndex && (overlaps(box.label, other.ring) || overlaps(box.label, other.card))));
        const deckCollision = boxes.some((box) => overlaps(box.ring, deck) || overlaps(box.label, deck));
        return !targetCollision && !referenceCollision && !labelCollision && !deckCollision;
      };
      let low = 24, high = baseCardWidth;
      for (let iteration = 0; iteration < 30; iteration += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle; else high = middle;
      }
      return low;
    })()
    : baseCardWidth;
  // Constrain width from both axes before deriving height so the card always
  // keeps the source 136:190 aspect ratio, including short containers.
  const widthByHeight = largeDiagnostic
    ? Math.max(24, (height - edge * 2 - labelHeight - labelGap) * baseCardWidth / (baseCardHeight + baseRing * 2))
    : Math.max(24, (height - edge * 2 - labelHeight - baseRing * 2) * baseCardWidth / baseCardHeight);
  // Four-target game layouts need a second, row-aware constraint. The old
  // size budget was chosen without accounting for the complete stimulus
  // surface (card + ring) in both rows, so at a short canvas the lower seat
  // could overlap the upper one. Solve the largest width whose two rows,
  // labels and required gap fit between the top/bottom safe edges.
  const fourRowWidthLimit = compactGameLayout && targetCount === 4
    ? (() => {
      const fits = (candidate: number) => {
        const candidateHeight = baseCardHeight * (candidate / baseCardWidth);
        const candidateRing = Math.min(baseRing * (candidate / baseCardWidth), Math.max(8, (shortSide - candidate) * 0.12));
        return 2 * candidateHeight + 4 * candidateRing <= height - edge * 2 - labelHeight - labelGap - minimumRowGap;
      };
      let low = 24, high = baseCardWidth;
      for (let iteration = 0; iteration < 28; iteration += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle; else high = middle;
      }
      return low;
    })()
    : baseCardWidth;
  const cardWidth = Math.min(baseCardWidth, fourRowWidthLimit, sixSafeWidthLimit, availableByGap, width - edge * 2, widthByHeight);
  const cardHeight = baseCardHeight * (cardWidth / baseCardWidth);
  const ring = Math.min(baseRing * (cardWidth / baseCardWidth), Math.max(8, (shortSide - cardWidth) * 0.12));
  const ringX = compactGameLayout && targetCount === 6
    ? Math.max(4, Math.min((legacySixStimulusWidth - cardWidth) / 2, cardWidth * 0.2))
    : ring;
  const ringY = compactGameLayout && targetCount === 6
    ? Math.max(3, Math.min((legacySixStimulusHeight - cardHeight) / 2, cardWidth * 0.2))
    : ring;
  const labelWidth = Math.max(48, cardWidth + ringX * 2);
  const referenceScale = compactGameLayout && targetCount === 6 ? 0.9 : 1;
  let fourRowCenters: { top: number; bottom: number } | null = null;
  if (compactGameLayout && targetCount === 4) {
    const sortedRows = [...new Set(positions.map((position) => position.y))].sort((a, b) => a - b);
    if (sortedRows.length >= 2) {
      const topDesired = sortedRows[0] * height;
      const bottomDesired = sortedRows[sortedRows.length - 1] * height;
      const minimumCenter = edge + cardHeight / 2 + ring;
      const maximumCenter = height - edge - cardHeight / 2 - ring - labelHeight;
    // Leave the top row's frequency label clear of the lower row's stimulus
    // surface while still meeting the visible inter-seat gap requirement.
    const requiredCenterGap = cardHeight + ring * 2 + labelGap + minimumRowGap;
      const top = Math.min(Math.max(topDesired, minimumCenter), maximumCenter - requiredCenterGap);
      const bottom = Math.max(Math.min(bottomDesired, maximumCenter), top + requiredCenterGap);
      fourRowCenters = { top, bottom };
    }
  }
  const makeTarget = (x: number, y: number, centerYOverride?: number, dimensions?: { width: number; height: number; ring: number; ringX?: number; ringY?: number }): ResponsiveStimulusGeometryTarget => {
    const targetCardWidth = dimensions?.width ?? cardWidth;
    const targetCardHeight = dimensions?.height ?? cardHeight;
    const targetRingX = dimensions?.ringX ?? dimensions?.ring ?? ringX;
    const targetRingY = dimensions?.ringY ?? dimensions?.ring ?? ringY;
    const targetLabelWidth = Math.max(48, targetCardWidth + targetRingX * 2);
    const centerX = clamp(x * width, edge + targetCardWidth / 2 + targetRingX, width - edge - targetCardWidth / 2 - targetRingX);
    const centerY = clamp(centerYOverride ?? y * height, edge + targetCardHeight / 2 + targetRingY, height - edge - targetCardHeight / 2 - targetRingY - labelHeight);
    return {
      centerX,
      centerY,
      card: { x: centerX - targetCardWidth / 2, y: centerY - targetCardHeight / 2, width: targetCardWidth, height: targetCardHeight },
      ring: { x: centerX - targetCardWidth / 2 - targetRingX, y: centerY - targetCardHeight / 2 - targetRingY, width: targetCardWidth + targetRingX * 2, height: targetCardHeight + targetRingY * 2 },
      label: { x: centerX - targetLabelWidth / 2, y: centerY + targetCardHeight / 2 + targetRingY + 6, width: targetLabelWidth, height: labelHeight },
    };
  };
  const reference = input.showReference === false ? null : makeTarget(input.referenceX ?? 0.5, resolvedReferenceY, undefined, { width: cardWidth * referenceScale, height: cardHeight * referenceScale, ring: 0 });
  return {
    version: "responsive-geometry-v1",
    cssWidth: width,
    cssHeight: height,
    devicePixelRatio: dpr,
    backingWidth: Math.round(width * dpr),
    backingHeight: Math.round(height * dpr),
    targetCount: input.targets.length,
    cardWidth,
    cardHeight,
    widthToHeightRatio: cardWidth / cardHeight,
    heightToWidthRatio: cardHeight / cardWidth,
    ring,
    ringX,
    ringY,
    targets: positions.map((target) => {
      const rowCenter = fourRowCenters
        ? target.y <= (Math.min(...positions.map((position) => position.y)) + Math.max(...positions.map((position) => position.y))) / 2
          ? fourRowCenters.top : fourRowCenters.bottom
        : undefined;
      return makeTarget(target.x, target.y, rowCenter);
    }),
    reference,
  };
}
