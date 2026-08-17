/**
 * The share card.
 *
 * The generator accepts a typed aggregate summary and nothing else. It cannot
 * be handed a transcript, a path or a payload, because there is no field for
 * one — which is a stronger guarantee than scrubbing would be.
 */
export interface ShareCard {
  readonly operations: number;
  readonly baselineBytes: number;
  readonly optimizedBytes: number;
  readonly tokensAvoided: number | undefined;
  readonly measurementLabel: string;
  readonly passedEvents: number;
  readonly verifiedEvents: number;
  readonly gatesPassed?: number;
  readonly gatesRequired?: number;
  readonly clientVersion: string;
}

/** Escapes every character XML treats specially. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function n(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Renders a self-contained SVG.
 *
 * No remote font, image or stylesheet is referenced: a share card that phones
 * home when someone opens it would be a tracking pixel, whatever it was called.
 * Fonts are a system-safe stack.
 */
export function renderShareCard(card: ShareCard): string {
  const reduction =
    card.baselineBytes === 0
      ? 0
      : (card.baselineBytes - card.optimizedBytes) / card.baselineBytes;

  const passRate =
    card.verifiedEvents === 0
      ? "no verdict"
      : `${card.passedEvents} / ${card.verifiedEvents}`;

  const rows: [string, string][] = [
    ["Verified passed", passRate],
    ...(card.gatesRequired !== undefined
      ? ([["Required gates passed", `${card.gatesPassed ?? 0} / ${card.gatesRequired}`]] as [
          string,
          string,
        ][])
      : []),
    ["Operations optimized", n(card.operations)],
    ["Payload bytes avoided", n(card.baselineBytes - card.optimizedBytes)],
    ["Context reduction", `${(reduction * 100).toFixed(1)}%`],
    ...(card.tokensAvoided === undefined
      ? ([] as [string, string][])
      : ([["Est. tokens avoided", n(card.tokensAvoided)]] as [string, string][])),
  ];

  const width = 640;
  const height = 150 + rows.length * 34;
  const font = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  const body = rows
    .map(
      ([label, value], index) =>
        `    <text x="36" y="${150 + index * 34}" class="label">${escapeXml(label)}</text>\n`
        + `    <text x="${width - 36}" y="${150 + index * 34}" class="value">${escapeXml(value)}</text>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="LeanRigor session summary">
  <style>
    .bg { fill: #0f1117; }
    .title { fill: #e6edf3; font: 600 22px ${font}; }
    .tag { fill: #7d8590; font: 400 13px ${font}; }
    .label { fill: #9198a1; font: 400 15px ${font}; }
    .value { fill: #e6edf3; font: 600 15px ${font}; text-anchor: end; }
    .foot { fill: #6e7681; font: 400 12px ${font}; }
  </style>
  <rect class="bg" width="${width}" height="${height}" rx="12" />
  <text x="36" y="54" class="title">LeanRigor</text>
  <text x="36" y="80" class="tag">Less context. Full engineering rigor.</text>
  <line x1="36" y1="104" x2="${width - 36}" y2="104" stroke="#30363d" stroke-width="1" />
${body}
  <text x="36" y="${height - 24}" class="foot">${escapeXml(card.measurementLabel)} · leanrigor ${escapeXml(card.clientVersion)}</text>
</svg>
`;
}
