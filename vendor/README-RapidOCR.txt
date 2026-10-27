ClearPage 1.6 text recovery attribution and provenance

RapidOCR 3.10.0: https://github.com/RapidAI/RapidOCR
Copyright RapidOCR Authors; Apache License, Version 2.0.
PP-OCRv6 upstream: https://github.com/PaddlePaddle/PaddleOCR
Copyright Baidu and/or applicable PaddleOCR rights holders; Apache-2.0.

ClearPage text_restore.py adapts the RGB-to-BGR, height-48 normalization and
CTC decoding conventions from RapidOCR's ch_ppocr_rec/main.py and utils.py.
These were modified into a standalone bounded word recognizer with CPU-only
ONNX Runtime, SHA-256 validation and no model downloading at application runtime.
PaddlePaddle's original recognition preprocessing carries Copyright (c) 2020
PaddlePaddle Authors. The font-search and agreement gates are ClearPage code.

Unmodified model from the rapidocr==3.10.0 PyPI wheel:
PP-OCRv6_rec_small.onnx, 21,234,383 bytes
SHA-256: 6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884
Registry download source:
https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx
The exact hash is also recorded in the upstream MODEL_LICENSES.md, included
here as RapidOCR-MODEL-LICENSES.md. License: RapidOCR-LICENSE.txt.

Runtime: onnxruntime==1.31.0, CPUExecutionProvider only, MIT.
https://github.com/microsoft/onnxruntime
No document images, recognized text or personal reference profiles are bundled.
Windows fonts are read from the employee's existing Windows installation and
are not redistributed. The model is pretrained, not fine-tuned on company data.
