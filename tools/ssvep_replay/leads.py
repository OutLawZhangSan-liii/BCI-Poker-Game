"""New exports use the fixed montage. Existing exports keep their recorded labels."""
from device_gateway.analysis_leads import ANALYSIS_LEADS

LEGACY_LEADS = ("O1", "O2", "P3", "P4")


def export_roi(channels):
    normalized = tuple(str(name).strip().upper() for name in channels)
    if normalized == tuple(lead.upper() for lead in ANALYSIS_LEADS):
        return (2, 3), ("Oz", "Pz")
    if normalized == LEGACY_LEADS:
        # Historical analysis only: never interpret O1/O2 samples as Oz/Pz.
        return (0, 1), ("O1", "O2")
    raise ValueError("Explicit P3/P4/Oz/Pz order required (legacy O1/O2/P3/P4 exports remain readable)")
