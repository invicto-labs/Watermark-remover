# Maintaining ClearPage releases

Keep application source in Git. Put employee ZIP packages in GitHub Releases;
the Windows package and model weights are too large for ordinary Git commits.
Customer PDFs, repaired pages, local session details, and downloaded model
weights must remain outside the repository.

## Verify a change

Use Windows x64 and Python 3.12. From the application source directory:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
.\.venv\Scripts\python.exe download_model.py
.\.venv\Scripts\python.exe download_text_model.py
.\.venv\Scripts\python.exe test_app.py
.\.venv\Scripts\python.exe test_overlays.py
.\.venv\Scripts\python.exe app.py
```

The download scripts verify the model hashes before installing them. These
downloads require internet access; normal document processing is local.
The tests create synthetic documents and do not require customer files.
Test the browser workflow, page selection, word repair, and exported PDF before
distributing a changed build. Test results are not a universal accuracy claim.

## Build for employees

Use a fresh virtual environment with the pinned dependencies above. Do not mix
dependencies from older build folders. Install `pyinstaller==6.22.3` and follow
the PyInstaller build command in README.md. Include both downloaded model files.
Keep the entire generated `dist/ClearPage` folder, including `_internal`.

Before distribution, include README.md, the vendor attribution/license files,
and the licenses/notices for Python and all bundled dependencies. Keep PDFium,
PyTorch, ONNX Runtime, and model notices with the package. Follow the complete
license terms in those files. Windows fonts are read from the employee's
computer and must not be copied into the package.

Test the packaged ClearPage.exe on Windows as well as running the source tests.
Open a PDF, preview, process, exclude a page, export, reopen the result, and close
the app. Extract and test the final ZIP so missing files are caught. Record the
ZIP's SHA-256 with `Get-FileHash -Algorithm SHA256 <zip-path>`.

## Publish a release on GitHub

1. Commit and push the reviewed source changes. Update the application version
   strings, README, and release notes together when changing the version.
2. In the repository's **Releases**, choose **Draft a new release**. Select the
   exact tested commit and a new version tag, for example `v1.7.1` for the next
   patch after 1.7. Do not move an existing release tag.
3. Attach the tested Windows ZIP and its SHA-256 checksum. GitHub also supplies
   a source archive for the tag; model weights are obtained through the scripts.
4. Describe the changes, supported inputs, verification performed, and known
   limitations. Publish when the employee package has passed review.

Employees download and extract the complete Windows ZIP, then open ClearPage.exe.
The app currently has no automatic updater; installing a new release is manual.
