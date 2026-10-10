"""Fixed current analysis leads; never rename acquisition metadata."""

ANALYSIS_LEADS = ("P3", "P4", "Oz", "Pz")


def analysis_channel_indices(names):
    normalized = [str(name).strip().upper() for name in names]
    missing = [lead for lead in ANALYSIS_LEADS if lead.upper() not in normalized]
    if missing:
        raise ValueError(f"required analysis leads missing from recording: {', '.join(missing)}")
    return [normalized.index(lead.upper()) for lead in ANALYSIS_LEADS]
