"""Run a private, repeatable reference benchmark. See BENCHMARK.md."""
import argparse
import json
from pathlib import Path
from statistics import mean
from engine import inspect_pdf, render_page
from quality_check import compare, validate_reference


def run(manifest):
    manifest = Path(manifest).resolve()
    cases = json.loads(manifest.read_text(encoding='utf-8'))['cases']
    if not isinstance(cases, list) or not cases:
        raise ValueError('The manifest needs a non-empty cases list.')
    reports=[]
    for case in cases:
        source, result, reference = [manifest.parent / case[key] for key in ('source','result','reference')]
        validate_reference(source, reference)
        validate_reference(source, result)
        count, _ = inspect_pdf(source)
        pages = case.get('pages', list(range(1, count+1)))
        if not isinstance(pages,list) or not pages or any(type(p) is not int or not 1<=p<=count for p in pages):
            raise ValueError('Benchmark page numbers must be a non-empty list of valid 1-based pages.')
        for page in sorted(set(pages)):
            metrics = compare(render_page(source,page-1),render_page(result,page-1),render_page(reference,page-1))
            reports.append(dict(case=case['id'],category=case['category'],page=page,**metrics))
    categories={}
    for category in sorted({r['category'] for r in reports}):
        rows=[r for r in reports if r['category']==category]
        metrics={}
        for key in ('correction_error_before','correction_error_after','preserved_reference_matching_pixels_percent',
                    'dark_pixel_recall_percent','dark_pixel_precision_percent','mean_rgb_error'):
            values=[r[key] for r in rows if r[key] is not None]
            metrics[key]=dict(mean_per_page=round(mean(values),3) if values else None,measured_pages=len(values))
        categories[category]=dict(pages=len(rows),metrics=metrics)
    return dict(schema_version=1,note='Pixel metrics, not word accuracy. Category means weight each measured page equally. Inspect alignment and verify reference wording before interpreting results.',categories=categories,pages=reports)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.suffix.lower()!='.json' or args.output.resolve()==args.manifest.resolve():
        parser.error('Choose a separate .json output file.')
    report=run(args.manifest)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(f'Measured {len(report["pages"])} pages in {len(report["categories"])} categories. Report: {args.output}')
