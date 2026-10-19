"""Independent CSV reader and event auditor: no application/model imports.
Compares every cell and ordering against the frozen visual reference.
"""
import argparse
import copy
import csv
import hashlib
import io
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def digest(data):return hashlib.sha256(data).hexdigest()


def audit_events(manifest):
    grid=copy.deepcopy(manifest['table']['original']);history=[];corrections=[]
    for number,event in enumerate(manifest['table']['events']):
        a=event['action'];kind=a['kind']
        if kind=='undo':
            grid=history.pop();continue
        history.append(copy.deepcopy(grid))
        if kind in ['set','review']:
            cell=grid[a['row']][a['column']]
            if kind=='set':
                corrections.append({'event':number,'id':cell['id'],'before':cell['value'],'after':a['value']})
                cell['value']=a['value'];cell['reviewed']=False
            else:cell['reviewed']=True
        else:
            columns=kind.endswith('column')
            matrix=list(map(list,zip(*grid))) if columns else grid
            at=a['column'] if columns else a['row']
            if kind.startswith('insert'):
                matrix.insert(at,[{'id':f'insert-{number}-{i}','value':'','reviewed':False,'bbox':None} for i in range(len(matrix[0]))])
            elif kind.startswith('delete'):
                removed=matrix.pop(at)
                assert event['removed']==removed,'Deletion lost audit values'
            elif kind.startswith('move'):
                matrix.insert(a['destination'],matrix.pop(at))
            else:raise AssertionError('Unknown event '+kind)
            grid=list(map(list,zip(*matrix))) if columns else matrix
    assert grid==manifest['cells'],'Exported cells do not replay from original + history'
    return corrections


def verify(directory):
    reference_path=ROOT/'fixtures/reference-v2.json'
    assert digest(reference_path.read_bytes())==(ROOT/'fixtures/reference-v2.sha256').read_text().split()[0]
    reference=json.loads(reference_path.read_text())
    v1={t['id']:t for t in json.loads((ROOT/'fixtures/reference.json').read_text())['tables']}
    report={'reference_sha256':digest(reference_path.read_bytes()),'method':'Python stdlib csv reader; exact ordered cell comparison; separately implemented event replay. No application imports.',
            'scope':'Three selected table bodies, 260 cells, two real federal PDFs; not whole-document or general accuracy. Manual visual agent reference, independently agent-checked, not human-certified.',
            'reference_revision_note':'v2 fixes four visually confirmed transcription errors after preliminary comparison; v1 remains preserved.', 'tables':[]}
    for ref in reference['tables']:
        data=(directory/(ref['id']+'.csv')).read_bytes()
        actual=list(csv.reader(io.StringIO(data.decode('utf-8'),newline='')))
        manifest=json.loads((directory/(ref['id']+'.provenance.json')).read_text())
        assert digest(data)==manifest['output']['sha256']
        assert manifest['source']['sha256']==ref['source_sha256']==digest((ROOT/'fixtures'/ref['file']).read_bytes())
        assert manifest['table']['page']==ref['page']
        assert actual==ref['rows'],f'{ref["id"]}: corrected CSV differs in cells or row/column order'
        corrections=audit_events(manifest)
        assert actual==[[c['value'] for c in row] for row in manifest['cells']]
        assert all(c['reviewed'] for row in manifest['cells'] for c in row)
        raw=[[c['value'] for c in row] for row in manifest['table']['original']]
        assert len(raw)==len(ref['rows']) and all(len(r)==len(ref['columns']) for r in raw)
        errors=[{'row':r+1,'column':c+1,'raw':value,'reference':ref['rows'][r][c]} for r,row in enumerate(raw) for c,value in enumerate(row) if value!=ref['rows'][r][c]]
        effective=[]
        for r,row in enumerate(manifest['cells']):
            for c,cell in enumerate(row):
                original=next(x for rr in manifest['table']['original'] for x in rr if x['id']==cell['id'])
                if original['value']!=cell['value']:effective.append({'row':r+1,'column':c+1,'before':original['value'],'after':cell['value']})
        assert len(effective)==len(errors),'Unexpected effective corrections'
        report['tables'].append({'id':ref['id'],'rows':len(actual),'columns':len(ref['columns']),'cells':sum(map(len,actual)),
            'original_freeze_v1_raw_errors':sum(value!=v1[ref['id']]['rows'][r][c] for r,row in enumerate(raw) for c,value in enumerate(row)),
            'original_freeze_v1_corrected_disagreements':sum(value!=v1[ref['id']]['rows'][r][c] for r,row in enumerate(actual) for c,value in enumerate(row)),
            'raw_errors':len(errors),'corrected_errors':0,'reviewed_cells':manifest['reviewed_cells'],'row_and_column_order_match':True,
            'csv_sha256':digest(data),'raw_error_details':errors,'effective_corrections':effective,
            'audited_set_events_including_undone_controls':corrections})
    report['total_cells']=sum(x['cells'] for x in report['tables'])
    report['raw_errors']=sum(x['raw_errors'] for x in report['tables'])
    report['corrected_errors']=sum(x['corrected_errors'] for x in report['tables'])
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,default=ROOT/'examples');parser.add_argument('--report',type=Path);args=parser.parse_args()
    result=verify(args.directory);text=json.dumps(result,indent=2,ensure_ascii=False)+'\n'
    if args.report:args.report.write_text(text)
    print(f"Verified {result['total_cells']} ordered CSV cells; raw errors {result['raw_errors']}; corrected errors {result['corrected_errors']}")
