"""Conservative PDF-object removal for verified record-site watermark layouts.

Scan streams are never decoded/re-encoded by the writer. Unknown layouts are
retained. Form edits are copy-on-write so shared resources on unchecked pages
cannot be changed by a selected page.
"""
import hashlib
import json
import math
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


def apdf_ranges(ops, resources):
    """Recognize the two verified A-PDF text layouts, not arbitrary diagonal text.

    Require an isolated, balanced block, standard Helvetica mapping, the A-PDF
    resource names, and its complete drawing grammar. Extra text, paths, custom
    encodings or graphics-state effects make the entire block ineligible.
    """
    resources = resolved(resources)
    fonts = resolved(resources.get('/Font', {}))
    states = resolved(resources.get('/ExtGState', {}))
    def close(values, expected):
        return len(values) == len(expected) and all(
            math.isfinite(float(a)) and abs(float(a)-b) < 0.00001
            for a, b in zip(values, expected))
    def identify(block):
        prefix = [b'q', b'gs', b'cm', b'Tr', b'Tf', b'rg', b'Tz', b'Ts', b'Tw', b'Tc']
        if [o for _, o in block[:10]] != prefix or block[-1] != ([], b'Q'):
            return None
        gs = block[1][0]; font = block[4][0]
        if len(gs) != 1 or len(font) != 2:
            return None
        if not str(gs[0]).startswith('/QQAPGS') or not str(font[0]).startswith('/QQAPF'):
            return None
        if resolved(fonts.get(font[0], {})) != {
                '/Type': '/Font', '/Subtype': '/Type1', '/BaseFont': '/Helvetica', '/Encoding': '/WinAnsiEncoding'}:
            return None
        state = resolved(states.get(gs[0], {}))
        if set(state) != {'/Type', '/SMask', '/ca', '/CA'} or state['/Type'] != '/ExtGState' or state['/SMask'] != '/None':
            return None
        for index, expected in [(3, [0]), (6, [100]), (7, [0]), (8, [0]), (9, [0])]:
            if not close(block[index][0], expected):
                return None
        # Only these confirmed styles/texts are automatically removed.
        for text, size, color, alpha, angle, label in [
                ('www.apdf.com', 30, [.8196, .4941, .6235], .44, 21, 'A-PDF tiled text'),
                ('Sample', 103.1638, [0, 0, 1], .51, 45, 'A-PDF rotated Sample')]:
            if not (close([font[1]], [size]) and close(block[5][0], color)
                    and close([state['/ca'], state['/CA']], [alpha, alpha])):
                continue
            cosine, sine = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            cursor = 10; matrix = block[2][0]; count = 0
            while cursor < len(block)-1:
                segment = block[cursor:cursor+6]
                if [o for _, o in segment] != [b'BT', b'Tm', b'Tj', b'ET', b'cm', b'cm']:
                    return None
                if (len(matrix) != 6 or not close(matrix[:4], [cosine, sine, -sine, cosine])
                        or not close(segment[1][0], [1, 0, 0, 1, 0, 0])
                        or segment[2][0] != [text]
                        or not close(segment[4][0], [cosine, -sine, sine, cosine, 0, 0])
                        or not close(segment[5][0], [1, 0, 0, 1, -float(matrix[4]), -float(matrix[5])])):
                    return None
                count += 1; cursor += 6
                if cursor < len(block)-1:
                    if block[cursor][1] != b'cm': return None
                    matrix = block[cursor][0]; cursor += 1
            if cursor == len(block)-1 and ((text == 'Sample' and count == 1) or (text == 'www.apdf.com' and count >= 2)):
                return label
        return None
    ranges = []; level = 0; start = 0
    for i, (_, op) in enumerate(ops):
        if op == b'q':
            if level == 0: start = i
            level += 1
        elif op == b'Q':
            level -= 1
            if level < 0: return []
            if level == 0:
                try:
                    label = identify(ops[start:i+1])
                except (TypeError, ValueError, KeyError, IndexError, OverflowError):
                    label = None
                if label: ranges.append((start, i+1, label))
    return [] if level else ranges


def rewrite_node(node, resources, owner, writer=None, depth=0, ancestors=()):
    if depth > 16 or id(node) in ancestors:
        return None, resources, []
    resources = resolved(resources)
    ops = ContentStream(node, owner).operations
    cook = cook_ranges(ops, resources)
    apdf = apdf_ranges(ops, resources)
    ranges = cook + apdf
    remove = {i for start, end, _ in ranges for i in range(start, end)}
    labels = ['Cook County'] * len(cook) + [label for _, _, label in apdf]
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
