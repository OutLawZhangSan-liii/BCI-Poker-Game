import { useId } from "react";

// One continuous reveal path traces the supplied artwork, including its branches.
// The broad mask exposes the original white silhouette without drawing a new logo.
const TRACE = "M220 600 C230 568 295 565 340 585 C384 606 440 620 472 657 C516 710 507 780 474 818 C443 854 401 859 354 889 C407 860 450 849 480 806 C509 764 511 704 483 667 C458 634 390 610 369 581 C351 556 351 526 332 505 L307 493 C335 501 351 542 365 574 C385 612 441 632 497 624 C545 615 607 581 636 539 C673 484 675 431 676 373 C662 419 662 469 677 516 C694 557 711 604 684 638 L650 667 C620 687 589 665 562 675 C550 711 615 741 715 753 C804 764 883 781 944 769 C989 760 1014 735 1043 716 C1011 738 989 764 944 777 C975 786 1010 811 1026 836 L1030 874 C1027 837 1007 813 973 795 C948 780 918 776 882 774 C808 772 716 765 654 747 C604 732 562 714 562 675 C551 650 603 594 654 530 C682 469 709 366 689 299";

export function IntroNeuron() {
  const maskId = `intro-neuron-${useId().replace(/:/g, "")}`;
  return <svg className="intro-flip__neuron" viewBox="0 0 1280 1280" aria-hidden="true">
    <defs>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="1280" style={{ maskType: "luminance" }}>
        <path className="intro-flip__neuron-trace" d={TRACE} pathLength="1" fill="none" stroke="white" strokeWidth="120" strokeLinecap="round" strokeLinejoin="round" />
        <rect className="intro-flip__neuron-finish" width="1280" height="1280" fill="white" />
      </mask>
    </defs>
    <image href={`${import.meta.env.BASE_URL}assets/branding/neuron-icon.png`} width="1280" height="1280" mask={`url(#${maskId})`} />
  </svg>;
}
