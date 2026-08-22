import type { CSSProperties } from 'react';
import './parentLockup.css';

/** NTB Labs parent lockup: <product name> by <NTB Labs wordmark>.
 *
 *  The studio-attribution pattern shared across NTB Labs products (Catan Lab,
 *  Sift, Confide, Lucid). Product name is the headline; the credit line reads
 *  quieter, and is subordinated by SIZE first and hue second (see
 *  parentLockup.css). The WORDMARK is the link home; the product name links
 *  nowhere, because you are already here.
 *
 *  Reusable by design: product name, color, link target, and parent name are
 *  all props, and every internal size is em-relative, so the host sets one
 *  font-size on the container and the whole lockup scales with it. No
 *  dependencies, no imported asset, no build plugin: the wordmark paths are
 *  inlined so `fill: currentColor` inherits the host's color.
 *
 *  Wordmark source of truth: src/ui/ntb-labs-wordmark.svg (normalized from
 *  ntb-labs-wordmark-dark.svg: <style> block removed, per-path class dropped,
 *  fill moved to currentColor on the <g>, no width/height, viewBox kept tight
 *  to the glyphs). If that file ever changes, update WORDMARK_PATHS to match.
 */

const WORDMARK_VIEWBOX = '5162.51 488.11 3623.52 436.43';

const WORDMARK_PATHS = [
  'M5165 918V494.99H5214.55L5468.36 810.43V494.99H5528.79V918H5479.24L5225.43 602.56V918Z',
  'M5827.31 918V547.56H5682.28V494.99H6032.17V547.56H5887.14V918Z',
  'M6185.66 918V494.99H6375.41Q6448.53 494.99 6487.81 524.3Q6527.09 553.61 6527.09 604.37Q6527.09 638.81 6511.08 662.68Q6495.06 686.55 6469.68 698.64Q6505.94 708.91 6527.7 735.2Q6549.45 761.49 6549.45 803.79Q6549.45 858.17 6508.66 888.09Q6467.87 918 6387.5 918ZM6246.09 869.05H6385.08Q6435.24 869.05 6461.83 852.13Q6488.42 835.21 6488.42 798.95Q6488.42 762.09 6461.83 745.17Q6435.24 728.25 6385.08 728.25H6246.09ZM6246.09 679.3H6369.97Q6415.9 679.3 6441.28 662.38Q6466.66 645.46 6466.66 611.62Q6466.66 577.78 6441.28 560.86Q6415.9 543.94 6369.97 543.94H6246.09Z',
  'M6980.92 918V494.99H7041.35V865.43H7270.38V918Z',
  'M7363.44 918 7555.01 494.99H7614.83L7807 918H7743.55L7697.02 812.25H7472.22L7425.69 918ZM7493.37 763.9H7675.87L7584.62 556.63Z',
  'M7957.47 918V494.99H8147.22Q8220.34 494.99 8259.62 524.3Q8298.9 553.61 8298.9 604.37Q8298.9 638.81 8282.89 662.68Q8266.87 686.55 8241.49 698.64Q8277.75 708.91 8299.5 735.2Q8321.26 761.49 8321.26 803.79Q8321.26 858.17 8280.47 888.09Q8239.68 918 8159.31 918ZM8017.9 869.05H8156.89Q8207.05 869.05 8233.64 852.13Q8260.22 835.21 8260.22 798.95Q8260.22 762.09 8233.64 745.17Q8207.05 728.25 8156.89 728.25H8017.9ZM8017.9 679.3H8141.78Q8187.71 679.3 8213.09 662.38Q8238.47 645.46 8238.47 611.62Q8238.47 577.78 8213.09 560.86Q8187.71 543.94 8141.78 543.94H8017.9Z',
  'M8625.83 922.83Q8577.48 922.83 8533.37 908.03Q8489.25 893.22 8463.87 869.66L8486.23 822.52Q8509.8 843.67 8547.57 857.57Q8585.34 871.47 8625.83 871.47Q8680.21 871.47 8705.29 852.74Q8730.37 834 8730.37 806.2Q8730.37 784.45 8716.47 771.16Q8702.57 757.86 8679.61 749.7Q8656.65 741.54 8629.45 735.5Q8602.26 729.46 8574.76 721.6Q8547.27 713.75 8524.61 700.75Q8501.94 687.76 8488.05 666.31Q8474.15 644.86 8474.15 611.02Q8474.15 578.38 8491.37 550.89Q8508.59 523.39 8544.55 506.77Q8580.5 490.16 8636.1 490.16Q8673.57 490.16 8709.52 499.82Q8745.48 509.49 8772.07 527.62L8752.12 575.97Q8724.93 558.44 8694.41 549.98Q8663.9 541.52 8636.1 541.52Q8582.32 541.52 8557.84 561.16Q8533.37 580.8 8533.37 608.6Q8533.37 630.96 8547.27 644.25Q8561.17 657.55 8584.13 665.4Q8607.09 673.26 8634.29 679.6Q8661.48 685.95 8688.98 693.8Q8716.47 701.66 8739.13 714.35Q8761.79 727.04 8775.69 748.19Q8789.59 769.34 8789.59 802.58Q8789.59 834.61 8772.07 862.1Q8754.54 889.6 8717.98 906.22Q8681.42 922.83 8625.83 922.83Z',
];

export interface ParentLockupProps {
  /** Rendered as the headline. Cased by the caller, e.g. 'CATAN LAB'. */
  productName: string;
  /** Any CSS color, typically a product palette token:
   *  color="var(--catan-gold)". The product name inherits it. Omit to inherit
   *  from the host. */
  color?: string;
  /** Color for the credit line ("by" plus the wordmark). Defaults to white.
   *  Deliberately a different hue from `color`: the product owns the brand
   *  color, the studio reads as light, and the contrast is what separates
   *  them. Pass a palette token, e.g. parentColor="var(--catan-cream)". */
  parentColor?: string;
  /** Studio home. Exact, no www, no trailing slash. */
  parentHref?: string;
  /** Accessible name for the wordmark link, and the text after "by" for
   *  assistive tech. */
  parentName?: string;
  /** Native tooltip on the wordmark link. Part of the affordance: the
   *  wordmark carries no link text, so the tooltip is what confirms where it
   *  goes for anyone who hovers before clicking. Defaults to
   *  "Visit <parentName>". */
  parentTitle?: string;
  /** The connective word. Swap for localization. */
  byLabel?: string;
  /** Merged onto the root, so the host can hand the lockup its own container
   *  styling (in Catan Lab that is the header pill). */
  className?: string;
}

export function ParentLockup({
  productName,
  color,
  parentColor,
  parentHref = 'https://ntblabs.dev',
  parentName = 'NTB Labs',
  parentTitle,
  byLabel = 'by',
  className,
}: ParentLockupProps) {
  return (
    <span
      className={className ? `lockup ${className}` : 'lockup'}
      style={{
        ...(color ? { color } : null),
        ...(parentColor
          ? ({ '--lockup-parent-color': parentColor } as CSSProperties)
          : null),
      }}
    >
      <span className="lockup__product">{productName}</span>
      <span className="lockup__attribution">
        <span className="lockup__by">{byLabel}</span>
        <a
          className="lockup__parent"
          href={parentHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={parentName}
          title={parentTitle ?? `Visit ${parentName}`}
        >
          <svg
            className="lockup__wordmark"
            viewBox={WORDMARK_VIEWBOX}
            aria-hidden="true"
            focusable="false"
          >
            <g fill="currentColor">
              {WORDMARK_PATHS.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          </svg>
        </a>
      </span>
    </span>
  );
}
