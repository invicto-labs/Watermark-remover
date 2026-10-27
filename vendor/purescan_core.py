"""Core mathematical algorithms for watermark detection and inverse blending."""

from typing import Optional, Tuple
import numpy as np


def extract_template(crops: np.ndarray) -> np.ndarray:
    """Extract pristine watermark template across sample crops via maximum projection.

    Because document pages contain vast white/light paper background (value ~ 255),
    the maximum pixel intensity across multiple independent pages reveals the
    watermark on pure white paper:
        C = (255 * T) / 255 = T

    Args:
        crops: 4D numpy array of shape (N, H, W, C) representing sample crops.

    Returns:
        Template array of shape (H, W, C) as float64.
    """
    if crops.ndim != 4 or crops.shape[0] == 0:
        raise ValueError("crops must be a non-empty 4D array (N, H, W, C)")
    return np.max(crops, axis=0).astype(np.float64)


def invert_multiply(
    crop: np.ndarray,
    template: np.ndarray,
    mask: Optional[np.ndarray] = None,
) -> np.ndarray:
    """Invert multiply (正片叠底) blending mode to restore original underlying pixels.

    Multiply model:
        C = (B * T) / 255.0

    Inverse restoration:
        B = clip(round((C * 255.0) / max(T, 1.0)), 0, 255)

    Args:
        crop: Input image array of shape (H, W, C) with dtype uint8.
        template: Watermark template on white background (H, W, C), float.
        mask: Optional boolean mask (H, W). If provided, only masked pixels are modified.

    Returns:
        Restored image array of shape (H, W, C) with dtype uint8.
    """
    orig_dtype = crop.dtype
    c_float = crop.astype(np.float64)
    t_safe = np.maximum(template, 1.0)

    restored = c_float * 255.0 / t_safe
    restored = np.clip(np.round(restored), 0, 255).astype(orig_dtype)

    if mask is not None:
        out = crop.copy()
        out[mask] = restored[mask]
        return out
    return restored


def detect_watermark_bbox(
    crops: np.ndarray,
    min_row_coverage: int = 15,
) -> Optional[Tuple[int, int, int, int]]:
    """Detect bounding box (y1, y2, x1, x2) of a consistent watermark across crops.

    Args:
        crops: 4D array of shape (N, H, W, C).
        min_row_coverage: Minimum active pixels per row to consider part of watermark.

    Returns:
        Tuple of (y1, y2, x1, x2) relative to crops shape, or None if not found.
    """
    if crops.ndim != 4 or crops.shape[0] < 2:
        return None

    n_samples, h, w, c = crops.shape

    # Color difference signature (effective for colored or tinted watermarks)
    diff_b = crops[:, :, :, 2].astype(int) - crops[:, :, :, 0].astype(int)
    diff_g = crops[:, :, :, 1].astype(int) - crops[:, :, :, 0].astype(int)
    sig_mask = (diff_b > 10) & (diff_g > 2) & (crops[:, :, :, 0] > 70)
    freq = np.sum(sig_mask, axis=0)

    threshold = max(2, n_samples // 3) if n_samples >= 3 else 1
    row_counts = np.sum(freq >= threshold, axis=1)
    peak_rows = np.where(row_counts >= min_row_coverage)[0]

    # Fallback to dark-text consistency on white background if no color signature
    if len(peak_rows) == 0:
        bg_max = np.max(crops, axis=0)
        delta_max = 255.0 - bg_max
        row_counts = np.sum(delta_max > 20, axis=(1, 2))
        peak_rows = np.where(row_counts > 100)[0]
        if len(peak_rows) == 0:
            return None

    r_min = max(0, int(peak_rows.min()) - 6)
    r_max = min(h, int(peak_rows.max()) + 7)

    col_counts = np.sum(freq[r_min:r_max, :] >= threshold, axis=0)
    active_cols = np.where(col_counts > 0)[0]
    if len(active_cols) == 0:
        c_min, c_max = 0, w
    else:
        c_min = max(0, int(active_cols.min()) - 15)
        c_max = min(w, int(active_cols.max()) + 16)

    return (r_min, r_max, c_min, c_max)
