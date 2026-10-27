# ClearPage 1.9

A local Windows application for watermark cleanup in PDFs and scanned images.


## New in 1.9

Open **PDF, JPG/JPEG, PNG, or TIFF** directly. Every page of a multipage TIFF is
imported in order. Images become a local PDF container; exports are always PDFs.
The original uploaded file is retained unchanged for the session. Decoded RGB
pixels are embedded without an additional JPEG compression pass. EXIF orientation
is applied, transparent areas become white, and usable DPI metadata determines
page size, rounded to the nearest half point to align exported corrections with
the preview grid. Missing or invalid DPI uses 144 DPI. Processing previews still use
144 DPI, so changed areas are not a full-resolution image-editing workflow.

Under **More options**, choose the watermark type and enable **Fix black pages
before watermark cleanup**. Detected negative scans are corrected before image
cleanup, OCR, donor matching, or PureScan learning. In website-overlay mode,
recognized overlays are removed before the scan colors are corrected. These
operations now share one preview/process/export workflow. Normal pages retain
their colors; uncertain negative scans can use the per-page inversion override.
All color-corrected pages require review and selection for export. The Before
preview remains the unmodified source. To correct colors only, select the
existing **Black page → white paper** mode instead.

The app keeps OCR and PureScan caches separate when colors change. Existing
word-repair patches cannot be reused with different color settings: keep the
previous setting, or save your work and reopen the original before changing it.
This avoids silently discarding or incorrectly recoloring accepted repairs.

Image imports allow up to 150 MB, 300 TIFF pages, 12 million decoded pixels per
page, and 120 million pixels per image file. A low DPI value that would exceed
the existing PDF render limits is rejected. Animated PNGs and other image
formats are not supported. A damaged or oversized import leaves no partial job.

## New in 1.8

**Black page → white paper** is available under More options / PDF type. It
analyzes each page for a negative scan and previews an exact RGB inversion at
144 DPI, without OCR or retyping. Normal and uncertain pages remain unchanged.
Use **Invert this page even if not detected** for a missed page. All proposed
inversions are unchecked for export until reviewed. Inversion reverses every
color, including photographs and stamps; standalone inversion does not remove watermarks. For the combined workflow,
choose a watermark type and enable the new color-correction checkbox.
The complete PDF retains page order, dimensions, crop and rotation; unselected
pages stay original. This is a rendered correction, not lossless restoration of
an original higher-resolution image. Existing word repairs are bypassed in this
mode and retained for image-cleanup modes.

**Quality check** compares the current processed preview with a trusted clean
PDF and exports a JSON report. For repeatable private benchmarks across releases,
see [BENCHMARK.md](BENCHMARK.md) and benchmark.py. These measure pixel differences
and preservation; they do not claim word accuracy or an overall percentage.

## Employees: start here

1. Extract **the entire ClearPage-1.9-Windows.zip** to a new folder on your computer.
2. Open the ClearPage folder and double-click **ClearPage.exe**. Keep the `_internal` folder beside the application.
3. The app opens in your default browser. Processing happens on your computer; an internet connection and Python installation are not required.
4. Click **Choose a PDF or scan**, or drag a supported file onto the upload box. Recognized website overlays use the same automatic selection as before. Other PDF types can be selected under **More options**.
5. Click **Try this page** for a preview, or **Clean all pages** to process the document. Compare **Before** and **After**. Use the page arrows and **Zoom in** to inspect the text.
6. Keep **Use this cleaned page** checked for pages you accept. Uncheck it to keep the original page. AI and uncertain results still keep the original by default. **Choose which pages to clean** provides the complete page list.
7. Click **Create PDF**, then **Download PDF**. All pages are included in their original order and with their original dimensions.
8. Click **Close app** when finished. Closing the browser tab alone does not stop the application.

### Simplified interface update (27 October 2026)

The main workflow is Open PDF, Clean & check, Save PDF. PDF-type settings, image-cleanup methods and saved repairs are under More options. Pixel statistics are under Page details; word-repair features are under Word repair tools. Processing, model files, default parameters, page-selection rules and export logic are unchanged from 1.7. Later technical sections retain some original control labels for reference.

More options includes a short document-to-setting guide and examples that update with the selected PDF type and cleanup method. The extra checkboxes, page selection and word-repair methods explain when to use them with concrete examples. Disabled website-mode controls explain why they are unnecessary. This guidance does not change processing settings.

The application is unsigned. If company device policy blocks it, have your IT team review the included source and approve or sign their own build. Do not bypass company device policy.

## What the cleanup does

- **Website PDF overlays:** removes recognized PDF text/vector overlays while retaining the exact embedded scan data. Cook County text blocks and the verified OKCountyRecords vector template are supported. The website need not be open; download the PDF and open it in ClearPage. This is not direct website browsing or universal site support. Unknown or changed templates stay unchanged in this mode. Preview and review every page; unchecked pages remain original. Image cleanup, saved repairs and OCR reconstruction are bypassed in this mode, including when requested through the API.
- **Huntington County diagonal:** matches the recurring “IMAGES/COPY PROPERTY…” watermark used in the original workflow. Uncertain detections appear as preview candidates, but are unchecked for export by default. Inspect their selected pixels before accepting them. It is not a universal watermark detector.
- **Custom area:** applies your brush selection at the same relative position on every page. Best for isolated marks over a blank background. Different layouts require careful review; exclude pages where the selection is inappropriate.
- **Careful:** preserves detected horizontal text and connected dark strokes. It may leave parts of the watermark.
- **Light:** protects dark pixels and nearby edges; only lighter marks are eligible for cleanup.
- The old **Strong** option has been removed because interpolating through text can damage letters. Legacy Strong API requests now use Careful text protection.

Careful and Light cleanup protect detected strokes. LaMa is a generative image model and can invent or omit letter strokes; it does not verify wording. Marks baked over letters can permanently hide information; perfect restoration is not guaranteed. Inspect important text and numbers against your original before relying on the result.

## Website PDF overlays (new in 1.7)

The scan remains at its original resolution, without recompression or retyping. Export edits the PDF drawing commands instead of covering the watermark with a new raster layer. Page count, geometry, rotation and order are preserved. Existing image-mode word repairs are retained in the session but do not apply to overlay-mode output. Password-free opening of PDFs with permissions encryption is supported; files requiring a password are still rejected.

Recognition is deliberately narrow: Cook County requires both exact watermark phrases in isolated Helvetica text blocks beside a scanned image. OKCountyRecords uses a fingerprint of the entire verified vector overlay and its resources, not merely a matching resource name. New website templates need additional inspection and validation before support can be claimed. This mode cannot separate a watermark already baked into scan pixels.

Validation covered all 24 pages in the supplied 22-page Cook County and 2-page Harper examples. Every embedded image stream remained byte-for-byte identical. All output pages matched independently prepared scan-only renders. Six additional synthetic regression tests cover shared forms, unchecked pages, crop/rotation preservation, unknown templates, password handling, cancellation, preview/export and reconstruction guards. The previous 32 tests also pass. Company PDFs are not distributed in the application package.

Sessions now use a separate local cookie per app instance so opening another version does not overwrite this version's login. Always start with the launcher to establish a session.

## Text recovery (added in 1.6)

The Windows package adds PaddleOCR's PP-OCRv6 recognition model through a small RapidOCR-based ONNX adapter. It compares the original word with the cleaned word locally. No images or recognized text are uploaded, and no GPU or download is needed at runtime. The 21 MB model is hash-verified before loading.

With **Restore matching words automatically** enabled, clean scanned-word copies are tried first. The new pass then searches Times, Arial and Courier variants, letter dimensions, position and edge weight against surviving original ink outside the watermark. It can reconstruct an entire word rectangle where the existing cleanup left damaged strokes. This replaces pixels inside the word rectangle, including pixels outside the watermark mask; the rest of the page is preserved.

Automatic font fits require an OCR agreement, strong surviving-shape evidence and enough visible ink. Changed spellings must also appear among intact words in the document. Short words, uncertain readings, numbers and unrecognized proper names remain for review. These rules reduce mistakes but do not prove that wording is correct. Shape scores and OCR confidence are not a document-accuracy percentage.

For a stubborn word, expand **Repair damaged words**, select its rectangle, and click **Read original & cleaned word**. This displays both unverified OCR readings without modifying the document or filling in confirmed wording. After checking the wording, choose **Fit confirmed text to original letters** and preview. A fit is refused if too little matching source ink remains. Clean-occurrence copying and typed repair remain available. Apply/undo and the downloadable repair log cover font fits too.

Automatic fits can be undone together using **Undo automatic repairs**; manual confirmed repairs remain. Remaining-overlap suggestions may offer a fitted spelling for review. Reprocessing retains accepted word repairs. A model cannot recover exact information that was completely covered by an opaque mark. This update has not demonstrated 88–95% accuracy on the company document; a clean reference is needed to measure that target.

Developers: install `requirements-ai.txt`, run both `python download_model.py` and `python download_text_model.py`, then `python app.py`. The source ZIP excludes both model files; the employee package includes both. See `vendor/README-RapidOCR.txt` and the included upstream licenses for exact model identity and attribution.

## Local LaMa AI restoration (new in 1.5)

The Windows AI package includes CPU PyTorch and the verified 206 MB LaMa model. No account, GPU, Python installation or network connection is needed. Extract the complete ZIP; do not run the executable inside the archive.

Choose **LaMa AI · reconstruct masked pixels** under Cleanup strength. Preview a page first, then use Process all pages if useful. It uses the selected Huntington mask or painted custom mask, starts from the original scan, and bypasses imported reviewed-page profiles for this mode. PureScan and LaMa are separate alternatives; choose one per pass. Automatic matching-word restoration and confirmed word repairs can still be applied afterward.

AI pages are unchecked for export initially because reconstructed strokes can alter wording. Inspect the original and preview at 100%, select the pages you accept, then Build complete PDF. Unselected pages remain in the PDF as originals. Several minutes may be needed for large documents on CPU; Stop takes effect between model regions or pages.

For one damaged word, expand **Repair damaged words**, select the word, enter its verified wording, and choose **LaMa AI · preview reconstructed strokes**. Preview, check the letters and surrounding text, then apply. The wording field is a review reference; it does not instruct the model to spell that word. Only the watermark-mask pixels within the word selection change. Clean-occurrence copying and rendering confirmed text remain available when the AI preview is inaccurate. Undo last word repair also works for AI repairs.

The model is pretrained LaMa, not a newly trained document model. It uses full preview-resolution tiles and copies only selected pixels, preserving every pixel outside the mask. Original files are never overwritten. Model identity is checked by SHA-256 before loading. See GITHUB-COMPARISON.md for measured results and vendor/AI-PROVENANCE.txt for sources and licenses.

Developers: use Python 3.12 on Windows, install `requirements-ai.txt`, then run `python download_model.py` once to retrieve the pinned weights. Run `python app.py`. The source ZIP omits weights and runtime binaries; the Windows package includes them.

## Blended watermark reduction with PureScan (new in 1.4)

Enable **Reduce blended remnants · PureScan**, then **Process all pages** using the Huntington preset and the original watermarked PDF. The first pass learns a template from up to 40 confidently aligned pages; at least six matching samples are required. Subsequent individual previews can reuse that template. If too few matching pages exist, the app retains Careful cleanup and explains the fallback on each page. Custom painted masks are not supported by this feature.

This integrates the unchanged MIT-licensed mathematical core from [Purestone/PureScan](https://github.com/Purestone/purescan/tree/d1e020828133e266238d976dfcb419dbd6778942), pinned to that commit. Its multiply-blend inversion is surrounded by ClearPage alignment and preservation checks. The full upstream PDF processor is not bundled: it assumes a compatible first RGB image on each page, whereas ClearPage renders tiled scans using its existing PDFium pipeline.

The new pass only touches the known watermark region, keeps previously changed pixels, protects near-black strokes (channel minimum <=32), and skips near-opaque template pixels (minimum <64). These choices intentionally leave unsupported remnants. It does not recover hidden letters or verify wording. Automatic and confirmed word repairs are applied afterward. Turn the checkbox off and reprocess to compare without inversion; already applied word repairs remain.

The preview reports how many pixels the inversion pass changed before word restoration. The feature is opt-in and does not claim lossless restoration of real scans. The source and Windows distribution include PureScan's MIT license and pinned provenance. No new network calls, models, or GPU requirements are introduced.

Exports and the page title now identify **ClearPage 1.9** so results can be distinguished from older app windows.

## Automatic word restoration (introduced in 1.3)

**Process all pages** runs automatic restoration when the sidebar checkbox is enabled. For a document already processed, click **Restore matching words on all pages**. The app reads the original and cleaned page images with local Windows OCR, indexes intact word samples, and compares visible letter shapes outside the watermark. It copies scanned words or short phrases only when both wording and image alignment match the acceptance criteria. Common capitalized terms are supported; numeric strings and unrecognized proper names are excluded from automatic replacement.

Similar-looking matches with different OCR wording, capitalization or punctuation are **not applied automatically**. Expand **Inspect remaining overlaps on this page** and click a suggestion to open its preselected repair area and clean source occurrence. Preview it and verify the wording before applying. Other listed overlaps are OCR readings, not verified text; some are already legible. The list is a review aid, not proof that every damaged character has been detected.

A separate pass clears larger isolated marks in blank space outside complete recognized text-line bands along the detected watermark path. It protects complete text-line bands (including words OCR may have missed), OCR word bounds, connected document strokes and small punctuation. Numbers, signatures, diagrams, faint printing and undetected marks still need visual review.

**Undo automatic repairs** removes the automatic word and background changes while retaining manual repairs. Automatic analysis stages its findings before applying them; stopping during analysis retains the existing cleanup. Reprocessing retains applied automatic and manual repairs. To start over, undo automatic repairs and then use per-page manual Undo as needed, or clear and reopen the document.

There is no guarantee of complete watermark removal or exact recovery of hidden text. Match scores measure image similarity, not factual certainty. Save and inspect the completed PDF before relying on it. Automatic repairs stay in the current document session and are included in the repair log; they are not silently added to the persistent reviewed-page library.

## Repair individual damaged words

After **Process all pages**, expand **Repair damaged words**. Use **Select damaged word** and drag a tight rectangle on the cleaned/right page, with a small margin around every letter. Zoom 100% helps select precisely.

Enter the exact wording you have checked. Choose one of two methods:

- **Copy a clean occurrence** preserves the original scanned font and texture. Choose a source page, then **Find matching word**. Windows OCR returns exact, case-sensitive matches outside the detected watermark. Select a thumbnail. If OCR misses a word, use **Select clean word manually** and draw around a clear occurrence on the original/left page. Match the spelling, punctuation, capitalization and style yourself. The selected source word is fitted into the target box; similarly sized selections give the most natural result.
- **Render confirmed text** draws your wording with a local Windows font. Choose Times, Arial or Courier and adjust ink strength. The text fits inside your selection. This supports English text and is a reconstructed facsimile, not recovered original glyphs.

Click **Preview word repair**, inspect the enlarged before/after crops and their surrounding text, confirm, then **Apply this word repair**. Preview does not change the page. Only the selected rectangle changes when applied. Use **Undo last word repair** to step back on the current page. Reprocessing this document retains your applied repairs. Rebuild the complete PDF after edits. Unchecking a page still exports its original, including original words.

**Save repair log** downloads the wording, page numbers and rectangles for applied word repairs in this session. Repairs and their undo history remain only until you clear the document or exit; save your PDF and log first. These word repairs are not automatically added to the persistent reviewed-page library. Importing a reviewed PDF still requires all differences to fall inside the allowed watermark region.

The finder requires a locally installed Windows OCR language and permission to run the bundled PowerShell helper. It never changes execution policy. If your device blocks OCR, manual source selection and typed reconstruction remain available. Windows fonts are loaded from the employee’s computer, not redistributed. No document wording is sent online or silently inferred.

## Reuse a reviewed copy

If you have already checked and corrected a PDF, open its **original watermarked version**, then click **Add a reviewed PDF copy** and select the corrected version. The pages must be in the same order and have the same dimensions. Import currently supports the Huntington watermark preset and rejects changes outside its detected area. It validates where changes occur, not whether the words in the reviewed copy are correct.

After import, click **Process all pages**. Previously reviewed corrections are reused only when the complete source page has the exact same rendered pixels, verified by SHA-256. A changed page, different record, different scan, or shifted watermark will not receive those repairs. Identical pages can be recognized even inside another PDF or in a different page order. Turn off **Reuse reviewed repairs** to use automatic cleanup alone.

This is a local repair library, not a general model trained to recover hidden text. A reviewed source can still contain mistakes. The interface identifies pages restored from your imported copy separately from automatically cleaned pages.

This is **visual cleanup, not secure redaction**. It adds visible corrections while retaining the underlying PDF objects. Original watermark pixels may still be recoverable from the file. It preserves the original as a separate file and never overwrites it.

## Supported input

- Windows x64 build; browser interface tested locally.
- Unlocked PDFs, up to 150 MB and 300 pages, with each rendered page up to 12 million pixels.
- Raster scans are the intended input. Website mode also removes the specifically recognized text/vector overlays described above; arbitrary native PDF overlays are not supported.
- Interactive forms are rejected. Do not use it to preserve or validate digital signatures. Any PDF edit can invalidate a signature.
- Pages with rotation and crop boxes are supported. Source page size, crop, rotation, order, and count are preserved.
- Scans are processed at 144 DPI; pixels outside the correction mask remain in the original PDF objects without recompression.

## Privacy and lifecycle

No cloud services, telemetry, or internet requests are used. The app binds to a random port on `127.0.0.1`, requires a random local session cookie, and rejects cross-site mutations. This is a single-user application, not a network server.

Working copies are stored in a randomly named `ClearPage-...` directory under your Windows temporary folder. **Clear document** removes the current working copies; **Exit app** removes the session directory and stops the server. Downloaded PDFs remain where you save them. Abrupt termination, a crash, or a power loss can leave temporary files behind; these can be removed from `%TEMP%` once ClearPage is closed. Files are deleted normally, not securely erased. Keep downloaded company documents in an approved local folder.

Imported reviewed repairs persist under `%LOCALAPPDATA%\ClearPage\reviewed-pages`. They contain small corrected image regions that may include document text. They are not uploaded or included in the distributable application ZIP. To forget them, close ClearPage and delete that folder. Each employee maintains their own library; follow company rules when sharing reviewed documents.

## For company IT / source installation

This repository contains the application source. See [RELEASING.md](RELEASING.md) for maintaining Windows releases. Use Python 3.12 x64:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
.\.venv\Scripts\python.exe download_model.py
.\.venv\Scripts\python.exe download_text_model.py
.\.venv\Scripts\python.exe app.py
```

To build and verify the portable Windows package from a fresh checkout:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe -m unittest discover -v -p 'test_*.py'
.\.venv\Scripts\python.exe scripts/release.py build
.\.venv\Scripts\python.exe scripts/release.py verify
```

The verified ZIP, SHA-256 checksums and build report are in `release-assets/`.
Publishing a version on GitHub runs the same tests and Windows build automatically,
then attaches the verified files to the release. Use **Actions → Windows release →
Run workflow** for a test build without publishing. See [RELEASING.md](RELEASING.md)
for version tags, failed builds and immutable releases.

Share the complete ZIP, including `_internal`. Code signing, a managed installer,
and automatic employee updates are not included. The source and application
contain no company document or repaired document text. The watermark preset
contains only the repeating watermark pattern.

## Verification

Run `python test_app.py`, `python test_overlays.py`, `python test_quality.py`, and `python test_scans.py` in the Windows source environment. Tests exercise cleanup boundaries, text preservation, rotated/cropped PDF export, page retention, local request protection, upload validation, preview, batch processing, selective export, and session cleanup. Word-repair tests also verify selection validation, exact-case donor matching, preview isolation, confirmation, stale-preview rejection, outside-rectangle preservation, reprocessing, exported pixels and exact undo. Quality tests cover negative scans, manual overrides, normal-page preservation, reference metrics and benchmark validation.
