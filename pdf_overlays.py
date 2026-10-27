"""Conservative PDF-object removal for verified record-site watermark layouts.

Scan streams are never decoded/re-encoded by the writer. Unknown layouts are
retained. Form edits are copy-on-write so shared resources on unchecked pages
cannot be changed by a selected page.
"""
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DictionaryObject, NameObject, DecodedStreamObject

COOK_TEXT = {'UNOFFICIAL COPY', "Property of Cook County Clerk's Office"}
# Fingerprint of the complete vector overlay resource tree, excluding compression.
OKCOUNTY_SIGNATURES = {'718b3e476d6fb4749ee58c0538191fc01cc5cb4a77831ff86d0ab21841277546'}


def resolved(value):
    return value.get_object() if hasattr(value, 'get_object') else value


def read_pdf(path):
    reader = PdfReader(path)
    if reader.is_encrypted and not reader.decrypt(''):
        raise ValueError('This PDF needs a password. Save an unlocked copy first.')
    return reader


def form_signature(obj):
    budget = [20000]
    def canonical(value, depth=0):
        budget[0] -= 1
        if depth > 20 or budget[0] < 0:
            raise ValueError('Overlay resource tree is too complex.')
        value = value.get_object() if hasattr(value, 'get_object') else value
        if isinstance(value, dict):
            result = {str(k): canonical(v, depth+1) for k, v in sorted(value.items())
                      if k not in ('/Length', '/Filter', '/DecodeParms')}
            if hasattr(value, 'get_data'):
                result['stream_sha256'] = hashlib.sha256(value.get_data()).hexdigest()
            return result
        if isinstance(value, (list, tuple)):
            return [canonical(v, depth+1) for v in value]
        return str(value)
    return hashlib.sha256(json.dumps(canonical(obj), sort_keys=True).encode()).hexdigest()


def cook_ranges(ops, resources):
    """Only standalone, graphics-state-isolated text blocks beside a scan."""
    resources = resolved(resources)
    xobjects = resolved(resources.get('/XObject', {}))
    if not any(op == b'Do' and args[0] in xobjects and
               xobjects[args[0]].get_object().get('/Subtype') == '/Image' for args, op in ops):
        return []
    ranges = []; depth = 0; start = None
    permitted = {b'q', b'Q', b'cm', b'BT', b'ET', b'Tm', b'Tf', b'rg', b'g', b'Tj'}
    for i, (args, op) in enumerate(ops):
        if op == b'q':
            if depth == 0: start = i
            depth += 1
        elif op == b'Q':
            depth -= 1
            if depth < 0: return []
            if depth == 0 and start is not None:
                block = ops[start:i+1]
                texts = [str(a[0]) for a, o in block if o == b'Tj']
                fonts = [a[0] for a, o in block if o == b'Tf']
                if (len(texts) == 1 and texts[0] in COOK_TEXT and len(fonts) == 1
                        and all(o in permitted for a, o in block)
                        and sum(o == b'BT' for a, o in block) == 1
                        and sum(o == b'ET' for a, o in block) == 1):
                    font = resolved(resources.get('/Font', {})).get(fonts[0])
                    font = font.get_object() if font else {}
                    if font.get('/BaseFont') == '/Helvetica' and font.get('/Subtype') == '/Type1' and not font.get('/ToUnicode') and font.get('/Encoding') in (None, '/WinAnsiEncoding'):
                        ranges.append((start, i+1, texts[0]))
    if depth or {r[2] for r in ranges} != COOK_TEXT:
        return []
    return ranges


def rewrite_node(node, resources, owner, writer=None, depth=0, ancestors=()):
    if depth > 16 or id(node) in ancestors:
        return None, resources, []
    resources = resolved(resources)
    ops = ContentStream(node, owner).operations
    ranges = cook_ranges(ops, resources)
    remove = {i for start, end, _ in ranges for i in range(start, end)}
    labels = ['Cook County'] * len(ranges)
    updated = []; removed_names = set()
    new_resources = DictionaryObject(dict(resources))
    xobjects = resolved(resources.get('/XObject', {}))
    new_xobjects = DictionaryObject(dict(xobjects))
    for i, (args, op) in enumerate(ops):
        if i in remove:
            continue
        if op == b'Do' and args[0] in xobjects:
            child = xobjects[args[0]].get_object()
            if child.get('/Subtype') == '/Form':
                try:
                    known = form_signature(child) in OKCOUNTY_SIGNATURES
                except (ValueError, RecursionError):
                    known = False
                if known:
                    labels.append('OKCountyRecords')
                    removed_names.add(args[0])
                    continue
                child_resources = child.get('/Resources', resources)
                content, res, found = rewrite_node(child, child_resources, owner, writer,
                                                   depth+1, (*ancestors, id(node)))
                if found:
                    labels.extend(found)
                    if writer is not None:
                        replacement = DecodedStreamObject()
                        replacement.update({k: v for k, v in child.items()
                                            if k not in ('/Length', '/Filter', '/DecodeParms')})
                        replacement.set_data(content)
                        replacement[NameObject('/Resources')] = res
                        # A fresh name also protects a repeated call within this stream.
                        name = NameObject('/ClearPageOverlay' + str(i))
                        while name in new_xobjects:
                            name = NameObject(str(name) + '_')
                        new_xobjects[name] = writer._add_object(replacement)
                        removed_names.add(args[0])
                        args = [name]
        updated.append((args, op))
    if not labels:
        return None, resources, []
    if writer is None:
        return None, resources, labels
    used_names = {a[0] for a, o in updated if o == b'Do'}
    for name in removed_names - used_names:
        new_xobjects.pop(name, None)
    new_resources[NameObject('/XObject')] = new_xobjects
    stream = ContentStream(None, owner)
    stream.operations = updated
    return stream.get_data(), new_resources, labels


def inspect(path):
    reader = read_pdf(path)
    pages = []
    for page in reader.pages:
        _, _, labels = rewrite_node(page.get_contents(), page.get('/Resources', {}), reader)
        pages.append(dict(overlays=len(labels), providers=sorted(set(labels))))
    return pages


def write_clean(source, target, keep, cancelled=lambda: False):
    reader = read_pdf(source)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    reports = []
    for index, page in enumerate(writer.pages):
        if cancelled(): raise InterruptedError('Cancelled')
        labels = []
        if index in keep:
            content, resources, labels = rewrite_node(page.get_contents(), page.get('/Resources', {}), writer, writer)
            if labels:
                stream = DecodedStreamObject(); stream.set_data(content)
                page[NameObject('/Contents')] = writer._add_object(stream)
                page[NameObject('/Resources')] = resources
        reports.append(dict(overlays=len(labels), providers=sorted(set(labels))))
    if cancelled(): raise InterruptedError('Cancelled')
    temporary = Path(str(target) + '.part')
    try:
        writer.write(temporary)
        if cancelled(): raise InterruptedError('Cancelled')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return reports
