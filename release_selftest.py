"""Offline checks run *inside* the frozen app by the release pipeline.

Only synthetic pixels are used. No documents, profiles, or network requests.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import neural_restore
import text_restore


def run(base, output):
    image = np.full((64, 128, 3), 255, dtype=np.uint8)
    image[28:36, 60:68] = 175
    mask = np.zeros(image.shape[:2], dtype=bool)
    mask[26:38, 58:70] = True
    result = neural_restore.inpaint(image, mask, base/'models/big-lama.pt')
    if result.shape != image.shape or not np.array_equal(result[~mask], image[~mask]):
        raise RuntimeError('Packaged LaMa did not preserve pixels outside the mask.')
    word = Image.new('RGB', (160, 48), 'white')
    ImageDraw.Draw(word).text((5, 8), 'RELEASE TEST', fill='black')
    prediction = text_restore.recognize(np.array(word), base/'models'/text_restore.MODEL_NAME)
    if not np.isfinite(prediction['confidence']):
        raise RuntimeError('Packaged ONNX recognition returned invalid output.')
    Path(output).write_text(json.dumps({'lama_inference': True, 'onnx_inference': True,
                                      'outside_mask_preserved': True}), encoding='utf-8')
