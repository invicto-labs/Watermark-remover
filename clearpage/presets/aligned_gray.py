"""Guarded per-page alignment of the bundled Unofficial Copy pattern.

No OCR or generated content. Weak matches are left to the existing preset.
"""
from pathlib import Path
import cv2
import numpy as np
from vendor.purescan_core import invert_multiply


def dotted_support(gray, smooth):
    """Look for ink dots and white gaps inside broad gray letter strokes."""
    core = cv2.erode(cv2.inRange(smooth, 145, 205), np.ones((7, 7), 'uint8')) > 0
    if np.count_nonzero(core) < gray.size * .002:
        return None
    textured = cv2.absdiff(gray, smooth) >= 18
    if np.mean(textured[core]) < .5:
        return None
    return core & textured


def protected_dotted_ink(gray, scope):
    # Isolated dark samples can be halftone dots. Keep connected stroke cores
    # and components anchored outside the matched watermark.
    dark = gray <= 25
    _, labels, stats, _ = cv2.connectedComponentsWithStats(dark.astype('uint8'), connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= 3
    keep[np.unique(labels[dark & ~scope])] = True
    keep[0] = False
    return keep[labels]


def clean(image, assets, cancelled=lambda: False, *, dotted=False):
    if cancelled(): raise InterruptedError('Cancelled')
    w,h=image.size
    if w*h > 12_000_000: raise ValueError('This scan is too large for gray-watermark cleanup.')
    if min(w,h)<200 or not .45 <= w/h <= .9: return None
    a=np.array(image.convert('RGB'));g=a.min(2)
    # This pattern is gray on white paper, not colored annotations or photos.
    if np.mean(np.ptp(a,axis=2)>12)>.01 or np.mean(g>225)<.55: return None
    signal = g
    if dotted:
        signal = cv2.GaussianBlur(g, (5, 5), 0)
        texture = dotted_support(g, signal)
        if texture is None:
            return None
    observed=((signal>110)&(signal<220)).astype('uint8')
    observed=cv2.morphologyEx(observed,cv2.MORPH_OPEN,np.ones((3,3),'uint8'))
    if observed.sum()<g.size*.008: return None
    with np.load(Path(assets)/'unofficial-copy-2024.npz',allow_pickle=False) as data:
        base=data['template']
    template=cv2.resize(base,(w,h))
    small=(620,round(h*620/w));ratio=620/w
    obs=cv2.GaussianBlur(cv2.resize(observed.astype('float32'),small),(5,5),0)
    reference=cv2.GaussianBlur(cv2.resize((template.min(2)<220).astype('float32'),small),(5,5),0)
    warp=np.eye(2,3,dtype='float32')
    try:
        score,warp=cv2.findTransformECC(obs,reference,warp,cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,150,1e-6),None,5)
    except cv2.error:
        return None
    if cancelled(): raise InterruptedError('Cancelled')
    warp[:,2]/=ratio
    # Reject unrelated letters, flipped/degenerate fits and excessive movement.
    if (not np.isfinite(warp).all() or not np.isfinite(score) or score < (.85 if dotted else .90)
        or not .7<float(np.linalg.det(warp[:,:2]))<1.4
        or not .75<warp[0,0]<1.2 or not .8<warp[1,1]<1.2
        or abs(warp[0,1])>.16 or abs(warp[1,0])>.2
        or abs(warp[0,2])>w*.19 or abs(warp[1,2])>h*.16): return None
    template=cv2.warpAffine(template,warp,(w,h),
        flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderValue=(255,255,255))
    scope=cv2.dilate((template.min(2)<245).astype('uint8'),np.ones((7,7),'uint8'))>0
    if dotted and np.count_nonzero(scope & texture) < np.count_nonzero(scope) * .05:
        return None
    # Include clipped continuation glyphs at the upper right page edge only
    # after the complete known phrase passes alignment.
    candidates=((g>110)&(g<220)).astype('uint8')
    candidates[int(h*.1):]=0;candidates[:,:int(w*.9)]=0
    _,labels,stats,_=cv2.connectedComponentsWithStats(candidates,8)
    keep=[j for j,(x,y,cw,ch,area) in enumerate(stats)
          if j and x+cw>=w-1 and area>=15]
    scope|=cv2.dilate(np.isin(labels,keep).astype('uint8'),np.ones((5,5),'uint8'))>0
    if cancelled(): raise InterruptedError('Cancelled')
    protected = protected_dotted_ink(g, scope) if dotted else g <= 75
    result=invert_multiply(a,template,scope & ~protected)
    ink=cv2.dilate(protected.astype('uint8'),np.ones((3,3),'uint8'))>0
    result[scope&~ink]=255
    changed=np.any(a!=result,axis=2)
    if not changed.any(): return None
    if not np.array_equal(a[protected],result[protected]) or not np.array_equal(a[~scope],result[~scope]):
        raise ValueError('Gray cleanup failed pixel-preservation checks.')
    return result,changed,dict(scan_pattern=True,confidence=None,matched=True,
        changed=int(changed.sum()),protected=int((scope & protected).sum()),
        reviewed=False,uncertain=True,ai=False,alignment_version=1,
        pattern_match=round(float(score),3),dark_pixels_exact=not dotted, dotted_copy=dotted,
        pattern_note=('Dotted Unofficial Copy removed. Review fine strokes where the lettering crossed the scan.'
                      if dotted else 'Unofficial Copy aligned separately to this page, including clipped edge marks. Original dark pixels and pixels outside the cleanup area are unchanged. Review faint text and overlaps before export; no words were generated.'))
