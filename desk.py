"""Extraction and replayable review model. All coordinates are top-left PDF points."""
import copy
import csv
import hashlib
import io
import math
from datetime import datetime, timezone

import pdfplumber
from pypdf import PdfReader

MAX_BYTES = 10 * 1024 * 1024
MAX_CELLS = 10000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def inspect_pdf(data):
    if not data.startswith(b'%PDF-') or len(data) > MAX_BYTES:
        raise ValueError('Import a PDF of at most 10 MiB.')
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError('Encrypted PDFs are unsupported, including empty-password encryption.')
    if not 1 <= len(reader.pages) <= 100:
        raise ValueError('Documents must contain 1–100 pages.')
    pages = []
    for p in reader.pages:
        box = p.mediabox
        if list(p.cropbox)!=list(box) or float(box.left)!=0 or float(box.bottom)!=0 or float(p.get('/UserUnit',1))!=1:
            raise ValueError('Cropped, offset, or scaled page boxes are unsupported. Normalize page boxes in a separate copy first.')
        if max(float(box.width), float(box.height)) > 2000:
            raise ValueError('Page dimensions must not exceed 2000 PDF points.')
        pages.append({'width': float(box.width), 'height': float(box.height), 'rotation': p.rotation})
    return pages


def numbers(values, lo, hi):
    if not isinstance(values, list) or len(values) > 500:
        raise ValueError('Use at most 500 separators.')
    vals = [float(x) for x in values]
    if any(not math.isfinite(x) or not lo < x < hi for x in vals) or vals != sorted(set(vals)):
        raise ValueError('Separators must be unique, increasing, and inside the selected region.')
    return vals


def extract(data, page_number, region, settings):
    pages = inspect_pdf(data)
    if type(page_number) is not int or not 1 <= page_number <= len(pages):
        raise ValueError('Page is out of range.')
    if not isinstance(region, list) or len(region) != 4:
        raise ValueError('Select a rectangular region.')
    x0, top, x1, bottom = map(float, region)
    if not all(math.isfinite(x) for x in [x0, top, x1, bottom]):
        raise ValueError('Region must be finite.')
    result = {'page': page_number, 'region': [x0, top, x1, bottom], 'settings': copy.deepcopy(settings),
              'status': 'unsupported', 'reason': '', 'original': [], 'events': [], 'created_at': now()}
    if pages[page_number-1]['rotation'] % 360:
        result['reason'] = 'Rotated pages are unsupported. Normalize rotation in a separate copy first.'
        return result
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page = pdf.pages[page_number-1]
        if not (0 <= x0 < x1 <= page.width and 0 <= top < bottom <= page.height):
            raise ValueError('Region must be inside the page.')
        if settings.get('layout', 'simple') in ['merged', 'multipage']:
            result['reason'] = 'Merged cells and multipage tables are unsupported. Select a simple subtable on one page.'
            return result
        if settings.get('layout', 'simple') not in ['simple', 'multiline']:
            raise ValueError('Unknown layout.')
        crop = page.crop((x0, top, x1, bottom))
        if not crop.chars:
            result['reason'] = 'No text layer in this region. Scans and image-only regions require OCR elsewhere.'
            return result
        if any(not c.get('upright', True) for c in crop.chars):
            result['reason'] = 'Rotated text is unsupported.'
            return result
        cuts = numbers(settings.get('columns', []), x0, x1)
        rowcuts = numbers(settings.get('rows', []), top, bottom)
        tolerance = float(settings.get('tolerance', 3))
        if not 0.1 <= tolerance <= 10:
            raise ValueError('Row tolerance must be between 0.1 and 10 points.')
        if settings.get('layout') == 'multiline' and not rowcuts:
            result['reason'] = 'Multiline cells require explicit horizontal row separators.'
            return result
        words = crop.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False)
        if not words:
            result['reason'] = 'No usable text in this region.'
            return result
        # Reject cuts through a word rather than silently dropping part of a value.
        if any(w['x0'] < x < w['x1'] for w in words for x in cuts):
            result['reason'] = 'A column separator crosses text. Move the separator; merged cells are not supported.'
            return result
        if any(w['top'] < y < w['bottom'] for w in words for y in rowcuts):
            result['reason'] = 'A row separator crosses text. Move the separator.'
            return result
        xs = [x0] + cuts + [x1]
        if rowcuts:
            ys = [top] + rowcuts + [bottom]
        else:
            lines = []
            for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
                if not lines or abs(w['top']-lines[-1][0]) > tolerance:
                    lines.append([w['top'], w['bottom']])
                else:
                    lines[-1][1] = max(lines[-1][1], w['bottom'])
            ys = [top] + [(a[1]+b[0])/2 for a,b in zip(lines,lines[1:])] + [bottom]
        if (len(xs)-1)*(len(ys)-1) > MAX_CELLS:
            raise ValueError('A region may contain at most 10,000 cells.')
        grid = []
        for r,(yt,yb) in enumerate(zip(ys,ys[1:])):
            row = []
            for c,(xl,xr) in enumerate(zip(xs,xs[1:])):
                ws = [w for w in words if xl <= (w['x0']+w['x1'])/2 < xr and yt <= (w['top']+w['bottom'])/2 < yb]
                groups = []
                for w in sorted(ws, key=lambda w: (w['top'],w['x0'])):
                    if not groups or abs(w['top']-groups[-1][0]['top']) > tolerance:
                        groups.append([w])
                    else:
                        groups[-1].append(w)
                value = '\n'.join(' '.join(w['text'] for w in sorted(g,key=lambda w:w['x0'])) for g in groups)
                row.append({'id':f'original-{r}-{c}', 'value':value, 'bbox':[xl,yt,xr,yb], 'reviewed':False})
            grid.append(row)
        result.update(status='extracted', original=grid, reason='Suggestions only: verify every value against the source.')
        result['resolved_grid'] = {'columns': xs, 'rows': ys}
        result['engine'] = {'name':'pdfplumber', 'version':pdfplumber.__version__, 'algorithm':'explicit-columns-word-lines-v1'}
        return result


def validate_grid(grid):
    if not isinstance(grid,list) or not grid or not grid[0] or len(grid)*len(grid[0]) > MAX_CELLS:
        raise ValueError('Invalid grid size.')
    ids = set()
    for row in grid:
        if len(row) != len(grid[0]):
            raise ValueError('Grid must be rectangular.')
        for cell in row:
            if not isinstance(cell.get('value'),str) or len(cell['value']) > 10000:
                raise ValueError('Cell values must be strings of at most 10,000 characters.')
            if not isinstance(cell.get('id'),str) or cell['id'] in ids:
                raise ValueError('Cell identifiers must be unique.')
            ids.add(cell['id'])
            box = cell.get('bbox')
            if box is not None and (not isinstance(box,list) or len(box)!=4 or not all(isinstance(x,(int,float)) and math.isfinite(x) for x in box)):
                raise ValueError('Invalid cell source bounds.')
            if type(cell.get('reviewed')) is not bool:
                raise ValueError('Invalid review flag.')


def apply(grid, action, event_id):
    kind = action['kind']
    r, c = action.get('row',0), action.get('column',0)
    if type(r) is not int or type(c) is not int:
        raise ValueError('Indices must be integers.')
    if kind in ['set','review']:
        if not 0 <= r < len(grid) or not 0 <= c < len(grid[0]):
            raise ValueError('Cell index out of range.')
        if kind == 'set':
            value = action.get('value')
            if not isinstance(value,str) or len(value)>10000:
                raise ValueError('Enter a string of at most 10,000 characters.')
            grid[r][c]['value'] = value
            grid[r][c]['reviewed'] = False
        else:
            grid[r][c]['reviewed'] = True
    elif kind in ['insert_row','delete_row','move_row','insert_column','delete_column','move_column']:
        column = kind.endswith('column')
        work = [list(x) for x in zip(*grid)] if column else grid
        idx = c if column else r
        limit = len(work) + (1 if kind.startswith('insert') else 0)
        if not 0 <= idx < limit:
            raise ValueError('Structural index out of range.')
        if kind.startswith('insert'):
            work.insert(idx,[{'id':f'insert-{event_id}-{i}','value':'','bbox':None,'reviewed':False} for i in range(len(work[0]))])
        elif kind.startswith('delete'):
            if len(work)==1:
                raise ValueError('Cannot remove the last row or column.')
            work.pop(idx)
        else:
            dest = action.get('destination')
            if type(dest) is not int or not 0 <= dest < len(work):
                raise ValueError('Destination out of range.')
            work.insert(dest,work.pop(idx))
        grid = [list(x) for x in zip(*work)] if column else work
    else:
        raise ValueError('Unknown action.')
    validate_grid(grid)
    return grid


def replay(table):
    if table.get('status') != 'extracted':
        if table.get('events') or table.get('original'):
            raise ValueError('Unsupported regions cannot contain reviewed cells.')
        return []
    grid = copy.deepcopy(table['original'])
    validate_grid(grid)
    if any(cell['reviewed'] for row in grid for cell in row):
        raise ValueError('Original extraction cannot be marked reviewed.')
    events = table.get('events',[])
    if not isinstance(events,list) or len(events)>20000:
        raise ValueError('Too many review events.')
    stack = []
    retained_cells = 0
    for i,event in enumerate(events):
        action = event['action']
        if action['kind']=='undo':
            if not stack:
                raise ValueError('Nothing to undo.')
            snapshot = stack.pop()
            retained_cells -= snapshot['cost']
            if snapshot['kind']=='cell':
                grid[snapshot['row']][snapshot['column']] = snapshot['cell']
            else:
                grid = snapshot['grid']
        else:
            if action['kind'] in ['set','review']:
                r,c=action.get('row',0),action.get('column',0)
                if type(r) is not int or type(c) is not int or not 0<=r<len(grid) or not 0<=c<len(grid[0]):
                    raise ValueError('Cell index out of range.')
                snapshot={'kind':'cell','cost':1,'row':r,'column':c,'cell':copy.deepcopy(grid[r][c])}
            else:
                snapshot={'kind':'grid','cost':len(grid)*len(grid[0]),'grid':copy.deepcopy(grid)}
            retained_cells += snapshot['cost']
            if retained_cells > 500000:
                raise ValueError('Review history limit reached (500,000 retained cell states). Split work into smaller regions.')
            stack.append(snapshot)
            grid = apply(grid,action,i)
    return grid


def edit(table, action):
    table = copy.deepcopy(table)
    before = replay(table)
    if not before:
        raise ValueError('Only extracted regions can be edited.')
    event = {'at':now(),'action':action}
    if action.get('kind') == 'delete_row':
        index=action.get('row'); event['removed'] = before[index] if type(index) is int and 0<=index<len(before) else []
    if action.get('kind') == 'delete_column':
        index=action.get('column'); event['removed'] = [row[index] for row in before] if type(index) is int and 0<=index<len(before[0]) else []
    table['events'].append(event)
    replay(table)
    return table


def csv_bytes(grid):
    out=io.StringIO(newline='')
    writer=csv.writer(out,lineterminator='\r\n')
    writer.writerows([[cell['value'] for cell in row] for row in grid])
    return out.getvalue().encode('utf-8')


def export_table(project, table):
    grid=replay(table)
    if not grid:
        raise ValueError('This region has no extracted cells.')
    data=csv_bytes(grid)
    manifest={'schema':'pdf-table-review-export/v1','exported_at':now(),
              'source':project['source'],'table':table,
              'output':{'encoding':'UTF-8','delimiter':',','line_ending':'CRLF','sha256':sha(data),
                        'rows':len(grid),'columns':len(grid[0]),'headers_in_csv':False},
              'cells':grid,'reviewed_cells':sum(c['reviewed'] for row in grid for c in row),
              'csv_policy':'Exact strings; RFC 4180 quoting. No formula escaping or numeric conversion. Import all columns as text in spreadsheets.',
              'region_accounting':[{'id':t['id'],'status':t['status'],'reason':t['reason']} for t in project['tables']]}
    return data,manifest
