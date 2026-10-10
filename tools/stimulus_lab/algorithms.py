"""CCA and verified TRCA/eTRCA; no production classifier is changed."""
import time
import numpy as np
from scipy import linalg, signal

ALGORITHM_VERSION = "lab-algorithms-v1"

def bandpass(raw, fs):
    if fs <= 100:
        raise ValueError("This protocol requires sample rate above 100 Hz for the fixed 2–45 Hz filter")
    sos = np.concatenate([signal.butter(4, 2, "highpass", fs=fs, output="sos"),
                          signal.butter(4, 45, "lowpass", fs=fs, output="sos")])
    # DC equilibrium, continuous state over the entire trial before any slicing.
    centered = np.asarray(raw, dtype=np.float64) - raw[0]
    return signal.sosfilt(sos, centered, axis=0)

def correlation(a, b):
    a, b = np.ravel(a), np.ravel(b)
    a, b = a - a.mean(), b - b.mean()
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / norm) if norm > 1e-12 else 0.

def cca_scores(data, fs, frequencies):
    x = data - data.mean(axis=0)
    u, singular, _ = np.linalg.svd(x, full_matrices=False)
    ux = u[:, singular > max(1e-12, singular[0] * 1e-8)]
    harmonics = min(3, int(45 / max(frequencies)))
    t = np.arange(len(data)) / fs
    scores = []
    for f in frequencies:
        y = np.column_stack([fn(2*np.pi*f*h*t) for h in range(1, harmonics+1) for fn in (np.sin, np.cos)])
        y -= y.mean(axis=0)
        uy, sy, _ = np.linalg.svd(y, full_matrices=False)
        uy = uy[:, sy > max(1e-12, sy[0]*1e-8)]
        value = np.linalg.svd(ux.T @ uy, compute_uv=False)[0] if ux.shape[1] else 0.
        scores.append(float(value*value))
    return scores

def train_trca(trials, labels, count):
    """Symmetric generalized eigenproblem S w = lambda Q w, as in src/trca.m."""
    started = time.perf_counter()
    filters, templates = [], []
    for label in range(count):
        original = [x for x,y in zip(trials,labels) if y == label]
        rows = [x-x.mean(axis=0) for x in original]
        if len(rows) < 2:
            raise ValueError("TRCA needs at least two independent training trials per target")
        global_mean = np.concatenate(original,axis=0).mean(axis=0)
        q = sum((x-global_mean).T @ (x-global_mean) for x in original)
        within = sum(x.T @ x for x in rows)
        total = sum(rows)
        s = total.T @ total - within  # all i != j cross-trial terms, both directions
        ridge = max(1e-12, np.trace(q)*1e-6 / q.shape[0])
        vals, vecs = linalg.eigh((s+s.T)/2, (q+q.T)/2 + np.eye(q.shape[0])*ridge)
        w = vecs[:, -1]
        if not np.isfinite(w).all() or vals[-1] <= 0:
            raise ValueError("TRCA verification failed: no reproducible positive component")
        filters.append(w); templates.append(np.mean(original,axis=0))
    return {"filters": np.column_stack(filters), "templates": templates,
            "trainingSeconds": time.perf_counter()-started, "trainingTrials": len(trials)}

def trca_scores(data, model, ensemble=False):
    x = data
    return [correlation(x @ (model["filters"] if ensemble else model["filters"][:,i]),
                        template @ (model["filters"] if ensemble else model["filters"][:,i]))
            for i,template in enumerate(model["templates"])]

def verification():
    """Check generalized eigenvectors against an independent pairwise reference."""
    rng = np.random.default_rng(731)
    fs = 250; t = np.arange(500)/fs
    trials, labels = [], []
    for label,f in enumerate([12,15]):
        for _ in range(4):
            trials.append(np.sin(2*np.pi*f*t)[:,None]*np.array([[1,.7,.4,.9]]) + rng.normal(0,.15,(500,4)))
            labels.append(label)
    model = train_trca(trials, labels, 2)
    for label in range(2):
        original = [x for x,y in zip(trials,labels) if y==label]
        rows = [x-x.mean(axis=0) for x in original]
        s = np.zeros((4,4)); q = np.zeros((4,4))
        for i,a in enumerate(rows):
            for j,b in enumerate(rows):
                if i != j: s += a.T@b
        ux=np.concatenate(original);ux-=ux.mean(axis=0);q=ux.T@ux
        q += np.eye(4)*max(1e-12,np.trace(q)*1e-6/4)
        w=model["filters"][:,label]; eigen=float(w@s@w/(w@q@w))
        if not np.allclose(s@w,eigen*q@w,rtol=1e-5,atol=1e-5): raise ValueError("TRCA eigenvector reference mismatch")
        x = np.sin(2*np.pi*[12,15][label]*t)[:,None]*np.array([[1,.7,.4,.9]])+rng.normal(0,.15,(500,4))
        for ensemble in [False,True]:
            scores=trca_scores(x,model,ensemble)
            if int(np.argmax(scores)) != label: raise ValueError("TRCA held-out synthetic detection failed")
            reference=[correlation(x@model["filters"],v@model["filters"]) for v in model["templates"]]
            if ensemble and not np.allclose(scores,reference): raise ValueError("ensemble projection mismatch")
    return {"passed": True, "reference": "mnakanishi/TRCA-SSVEP src/trca.m / src/test_model.m", "filterPolicy": "single 2–45 Hz band; ridge=trace(Q)*1e-6/channels", "version": ALGORITHM_VERSION}
