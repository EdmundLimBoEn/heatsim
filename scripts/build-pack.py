#!/usr/bin/env python3
"""Generate the 1:65 cardboard build pack from the app's unchanged source geometry."""
import argparse
import csv
import html
import json
import math
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/build-pack'
SCALE = 65
MM = 1000 / SCALE
EXT, INT = 3.0, 3.0
PRIMARY = {'window_bedroom3_1':'WIN1','window_living_1':'WIN2','window_living_3':'WIN3','main_door':'DOOR1','door_bedroom3':'DOOR2'}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT / 'assets/hdb-3d/hdb_4room_boxes.json')
args = parser.parse_args()
data = json.loads(args.source.read_text())
boxes = data['boxes']
wall_boxes = [b for b in boxes if b['type'] == 'wall']
xmin = min(b['min'][0] for b in wall_boxes)
zmin = min(b['min'][2] for b in wall_boxes)
xmax = max(b['max'][0] for b in wall_boxes)
zmax = max(b['max'][2] for b in wall_boxes)
W, D, H = (xmax-xmin)*MM, (zmax-zmin)*MM, data['ceiling_height']*MM
X = lambda x: (x-xmin)*MM
Z = lambda z: (z-zmin)*MM
assert W <= 200 and D <= 150
assert math.isclose(W, 187.6923076923) and math.isclose(D, 118.4615384615)
assert math.isclose(H, 40)

# Long panels pass through a junction; short panels stop at the long panel's face.
def wall(name, axis, fixed, start, end, thickness):
    return dict(id=f'W{len(walls)+1:02}', name=name, axis=axis, center_mm=fixed,
                start_mm=start, end_mm=end, length_mm=end-start, height_mm=H,
                thickness_mm=thickness, practical_length_mm=round(end-start,1))

walls = []
for spec in [
 ('wall_ext_north','x',EXT/2,0,W,EXT),
 ('wall_ext_south','x',D-EXT/2,0,W,EXT),
 ('wall_ext_west','z',EXT/2,EXT,D-EXT,EXT),
 ('wall_ext_east','z',W-EXT/2,EXT,D-EXT,EXT),
 ('wall_north_corridor','x',Z(3.4),EXT,W-EXT,INT),
 ('wall_master_masterbath','z',X(3.8),EXT,Z(3.4)-INT/2,INT),
 ('wall_bath_bedroom2','z',X(5.6),EXT,Z(3.4)-INT/2,INT),
 ('wall_bedroom2_bedroom3','z',X(8.8),EXT,Z(3.4)-INT/2,INT),
 ('wall_masterbath_commonbath','x',Z(2.0),X(3.8)+INT/2,X(5.6)-INT/2,INT),
 ('wall_kitchen_corridor','z',X(2.8),Z(3.4)+INT/2,D-EXT,INT),
 ('wall_kitchen_yard','x',Z(5.6),EXT,X(2.8)-INT/2,INT),
 ('wall_shelter_north','x',Z(5.9),X(2.8)+INT/2,X(4.4)+INT/2,INT),
 ('wall_shelter_east','z',X(4.4),Z(5.9)+INT/2,D-EXT,INT),
]:
    walls.append(wall(*spec))
by_wall = {w['name']:w for w in walls}
openings = []
counts = {'door':0, 'window':0}
for b in boxes:
    if b['type'] not in counts:
        continue
    kind = b['type']
    counts[kind] += 1
    axis = 0 if b['wall_axis'] == 'x' else 2
    transform = X if axis == 0 else Z
    parent = by_wall[b['wall']]
    left, right = [transform(a) for a in b['opening_min_max_along_wall']]
    source_width = right-left
    if b['name'] == 'door_master_bedroom':
        right = min(right, X(3.8)-INT/2)
    width = right-left
    height = (b['max'][1]-b['min'][1])*MM
    sill = b['min'][1]*MM
    openings.append(dict(id=f'{"D" if kind == "door" else "G"}{counts[kind]:02}',
        name=b['name'], kind=kind, wall_id=parent['id'], wall_name=b['wall'],
        offset_mm=left-parent['start_mm'], width_mm=width, height_mm=height, source_width_mm=source_width, physical_adjustment='East edge trimmed to 3 mm master/bath partition face' if width < source_width-1e-6 else '',
        sill_mm=sill, leaf_width_mm=width-(1.5 if kind == 'door' else 0.5), leaf_height_mm=height-0.5, hardware_channel=PRIMARY.get(b['name'],''), movement='face-mounted inward tape hinge' if kind == 'door' else 'lift-out first; optional sliding rail after measuring hardware',
        exterior=b['exterior'], hinge_side='west' if axis == 0 and abs(b['hinge_point'][axis]-b['opening_min_max_along_wall'][0]) < 1e-6 else 'north' if axis == 2 and abs(b['hinge_point'][axis]-b['opening_min_max_along_wall'][0]) < 1e-6 else 'east' if axis == 0 else 'south', hinge_at_mm=[X(b['hinge_point'][0]), b['hinge_point'][1]*MM, Z(b['hinge_point'][2])]))
assert counts == {'door':9,'window':11}
assert len(walls) == 13
for p in walls:
    p['openings'] = [o['id'] for o in openings if o['wall_id'] == p['id']]
    assert p['length_mm'] > 0
assert sum(bool(o['hardware_channel']) for o in openings)==5
assert next(o for o in openings if o['id']=='D09')['hinge_side']=='east'
for o in openings:
    assert o['leaf_width_mm']>0 and o['leaf_height_mm']>0
    p = by_wall[o['wall_name']]
    assert o['offset_mm'] >= 0 and o['offset_mm']+o['width_mm'] <= p['length_mm']+1e-8
    assert o['sill_mm']+o['height_mm'] <= H+1e-8

rooms = [dict(name=r['name'], width_mm=(r['max'][0]-r['min'][0])*MM,
              depth_mm=(r['max'][2]-r['min'][2])*MM, source_area_m2=r['area_m2']) for r in data['rooms']]
manifest = dict(scale=SCALE, units='mm', outside_footprint_mm=[W,D], wall_height_mm=H,
                building_target_mm=[200,150], base_mm=[210,297],
                material_thickness_mm=dict(exterior=EXT,interior=INT),
                coordinate_origin='Outer northwest corner; x east, z south, y above floor',
                walls=walls, openings=openings, rooms=rooms,
                hardware=dict(status='SSTuino planned but not yet available; servos, limit switches and buttons listed by the user; fitting, exact parts, mounting sizes, pins and power pending',
                              primary_controls='Door and window states; app fans, AC and purifier controls are separate software controls',
                              reserved_panel_mm=[190,65], panel_holes='Do not cut until actual parts are measured'))
OUT.mkdir(parents=True, exist_ok=True)
(OUT/'dimensions.json').write_text(json.dumps(manifest,indent=2)+'\n')
def csv_file(name, rows):
    with (OUT/name).open('w',newline='') as f:
        writer = csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
csv_file('cut-list.csv',[{k:round(v,4) if isinstance(v,float) else v for k,v in w.items() if k != 'openings'} for w in walls])
csv_file('openings.csv',[{k:round(v,4) if isinstance(v,float) else v for k,v in o.items() if k != 'hinge_at_mm'} for o in openings])
csv_file('rooms.csv', rooms)

class SVG:
    def __init__(self,title):
        self.parts=['<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">',
                    f'<title>{html.escape(title)}</title>', '<rect width="210" height="297" fill="white"/>',
                    '<style>text{font-family:Arial,sans-serif;fill:#17332e}</style>']
    def rect(self,x,y,w,h,fill='none',stroke='#526d66',sw=.25,dash=''):
        self.parts.append(f'<rect x="{x:.5f}" y="{y:.5f}" width="{w:.5f}" height="{h:.5f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-dasharray="{dash}"/>')
    def line(self,x1,y1,x2,y2,stroke='#526d66',sw=.25):
        self.parts.append(f'<line x1="{x1:.5f}" y1="{y1:.5f}" x2="{x2:.5f}" y2="{y2:.5f}" stroke="{stroke}" stroke-width="{sw}"/>')
    def text(self,x,y,text,size=2.6,anchor='start',weight='normal'):
        self.parts.append(f'<text x="{x:.5f}" y="{y:.5f}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}">{html.escape(str(text))}</text>')
    def save(self,path):
        value='\n'.join(self.parts+['</svg>'])
        path.write_text(value)
        return value

def header(s,title,subtitle):
    s.text(10,12,'HEATSIM / PHYSICAL BUILD',3,weight='bold')
    s.text(10,21,title,5,weight='bold')
    s.text(10,27,subtitle,2.6)

def footer(s,annotation_clearance=False):
    s.line(10,280,60,280,sw=.6)
    for x in [10,60]: s.line(x,278,x,282,sw=.4)
    s.text(35,286,'50 mm — measure before cutting',2.5,'middle')
    s.text(200,284 if annotation_clearance else 280,'A4 · Actual size / 100%',2.7,'end',weight='bold')
    s.text(200,288 if annotation_clearance else 286,'All dimensions in mm · 1:65 scale',2.5,'end')
    s.text(10,293,'Written by gpt-6-astra in Codex on behalf of Edmund',1.8)

s = SVG('HeatSim 1:65 floor plan — print A4 at actual size')
header(s,'Floor plan / 1:65','Building: 187.692 × 118.462 mm. Wall height: 40 mm. Outer footprint fits 200 × 150 mm.')
ox,oy=(210-W)/2,48
s.rect(5,34,200,150,stroke='#a9b8af',dash='2 2')
s.text(7,39,'200 × 150 mm building work area',2.4)
for r in data['rooms']:
    x,z=X(r['min'][0]),Z(r['min'][2]); w=(r['max'][0]-r['min'][0])*MM; d=(r['max'][2]-r['min'][2])*MM
    wet = 'bath' in r['name'] or r['name'] in ['kitchen','service_yard']
    s.rect(ox+x,oy+z,w,d,fill='#edf4f2' if wet else '#f8f5ec',stroke='#ddd9cb',sw=.1)
    lines=r['name'].replace('bedroom2','bedroom 2').replace('bedroom3','bedroom 3').replace('_',' ').split(' ')
    if len(lines)>1: lines=[' '.join(lines[:-1]),lines[-1]]
    for i,label in enumerate(lines): s.text(ox+x+w/2,oy+z+d/2+(i-.5)*3,label,2.3,'middle',weight='bold')
    s.text(ox+x+w/2,oy+z+d/2+6,f'{w:.1f} × {d:.1f}',2.1,'middle')
for p in walls:
    horizontal=p['axis']=='x'; x=p['start_mm'] if horizontal else p['center_mm']-p['thickness_mm']/2; z=p['center_mm']-p['thickness_mm']/2 if horizontal else p['start_mm']
    w=p['length_mm'] if horizontal else p['thickness_mm']; d=p['thickness_mm'] if horizontal else p['length_mm']
    s.rect(ox+x,oy+z,w,d,fill='#405c52',stroke='none')
    for o in [o for o in openings if o['wall_id']==p['id']]:
        a=p['start_mm']+o['offset_mm']; color='#a8552b' if o['kind']=='door' else '#2273a1'
        if horizontal:
            s.rect(ox+a,oy+z,o['width_mm'],d,fill='#fff',stroke='none'); s.line(ox+a,oy+p['center_mm'],ox+a+o['width_mm'],oy+p['center_mm'],color,.6)
            s.text(ox+a+o['width_mm']/2,oy+p['center_mm']+1,o['id']+(' · '+o['hardware_channel'] if o['hardware_channel'] else ''),1.9,'middle',weight='bold')
        else:
            s.rect(ox+x,oy+a,w,o['width_mm'],fill='#fff',stroke='none'); s.line(ox+p['center_mm'],oy+a,ox+p['center_mm'],oy+a+o['width_mm'],color,.6)
            s.text(ox+p['center_mm']+(-2 if p['name']=='wall_ext_east' else 2),oy+a+o['width_mm']/2,o['id']+(' · '+o['hardware_channel'] if o['hardware_channel'] else ''),1.9,'end' if p['name']=='wall_ext_east' else 'start',weight='bold')
    if horizontal:
        s.text(ox+p['start_mm']+p['length_mm']/2,oy+p['center_mm']-2,p['id'],2,'middle')
    else: s.text(ox+p['center_mm']+2,oy+p['start_mm']+p['length_mm']/2,p['id'],2)
s.line(ox,43,ox+W,43); s.line(ox,41,ox,45); s.line(ox+W,41,ox+W,45)
s.text(105,42,f'{W:.3f}',2.4,'middle')
s.text(105,174,f'Outside depth {D:.3f} mm · green = card · brown D = door · blue G = window',2.5,'middle')
s.text(10,191,'ROOM LABELS ARE SOURCE ROOM RECTANGLES, NOT CLEAR INTERNAL DIMENSIONS.',2.4,weight='bold')
s.text(10,197,'All walls: 3 mm cardboard. Interior joints adjusted; D02 doorway narrowed to clear its partition. Keep cardboard inside the green footprints.',2.5)
s.rect(10,205,190,65,stroke='#7d9690',dash='2 2')
s.text(15,214,'REMOVABLE CONTROLS / ELECTRONICS AREA — 190 × 65 mm',2.8,weight='bold')
s.text(15,221,'SSTuino planned, not yet available. Buttons / servos listed; fitting pending.',2.6)
s.text(15,227,'Layout reserve only. Measure actual boards, servo travel and cable plugs first.',2.6)
s.text(15,233,'Do not cut mounting holes from this drawing. No pin assignments implied.',2.6)
s.text(15,245,'Keep moving leaves and wires inside the A4 base. Use removable wiring routes.',2.5)
s.text(15,257,'Exactly TWO A4 sheets of 3 mm card: existing base + one wall sheet. NO ROOF.',2.5)
footer(s)
s.save(OUT/'floor-plan.svg')

md = '''# HeatSim physical model — builder handoff

**Start here: 1:65 scale; 187.692 × 118.462 mm outside building footprint; 40 mm walls.**

The 12.2 × 7.7 m source apartment fits inside a 200 × 150 mm work area on an A4 210 × 297 mm cardboard base. This is an approximate teaching layout, not an official HDB plan. A4 is larger than 150 × 200 mm; both constraints are met without stretching the plan.

## Download / print first

- [Floor plan, A4 actual size](../public/build-pack/floor-plan.svg)
- [All wall dimensions CSV](../public/build-pack/cut-list.csv)
- [Door and window cutouts CSV](../public/build-pack/openings.csv)
- [Exact dimensions JSON](../public/build-pack/dimensions.json)

Print **100% / Actual size**, disable “Fit to page” and browser headers/footers, and measure the **50 mm calibration bar**. All measurements below are millimetres. Coordinates start at the outside northwest corner, x to the east and z to the south. Dimensions use the outer faces, with 3 mm cardboard for every wall kept inside those footprints. Actual material thickness must be measured before fitting.

## Reading the added measurements

The annotations do not change any existing cut. In the printed panel view, **x walls are viewed from the south with west at the left; z walls are viewed from the west with north at the left**. Keep this face/orientation; do not mirror a panel. **L** measures from the panel's left cut edge to the opening's left cut edge. Grey ticked lines below each panel show the clear gap before the first opening, between adjacent opening edges, and the final **R** gap to the right panel edge. **Grey measurement lines are not cut lines.** Values are displayed to 0.001 mm; the underlying geometry is unchanged. Wall elevation sheet 4 contains the complete offset/gap/width/height/sill schedule. The W10/D07 left gap is only 0.038 mm; its leader is displaced for readability, not a larger physical gap.

## Wall cut list

Every panel is **40 mm tall**. Exact values are the fabrication geometry; the practical column rounds to 0.1 mm for marking. Dry-fit and trim. Horizontal panels run west to east; vertical panels run north to south. Cut doors and windows before assembly.

| ID | Wall | Exact length | Mark length | Thickness | Direction | Start → end | Centre line |
|---|---|---:|---:|---:|---|---:|---:|
'''
for p in walls:
    md+=f"| {p['id']} | {p['name'].removeprefix('wall_').replace('_',' ')} | {p['length_mm']:.4f} | {p['practical_length_mm']:.1f} | {p['thickness_mm']:g} | {p['axis']} | {p['start_mm']:.4f} → {p['end_mm']:.4f} | {p['center_mm']:.4f} |\n"
md+='''
## Joints and materials

- W01/W02 north/south exterior panels pass across the full building width. W03/W04 east/west panels butt between them. Do not add their thickness a second time.
- W05 corridor runs between the exterior inner faces. W06–W08 north partitions butt between W01 and W05. W09 bath divider fits between W06 and W07.
- W10 kitchen/corridor partition butts from W05 to W02. W11 kitchen/yard divider fits between W03 and W10.
- W12 shelter north reaches the east outer face of W13; W13 butts under W12 and against W02. W12 starts at W10's east face.
- The thicker master/bath partition would overlap D02: its physical opening is shortened by 0.7308 mm at the east end to **11.5769 mm clear width** (source width 12.3077 mm). The printed cutout and leaf already include this change. Bedroom 2/3 and kitchen door-side junctions have only 0.0385 mm theoretical clearance; treat them as flush corners and reinforce with tape. Do not attempt tiny separate jamb strips.
- **No roof.** The model remains open for visibility and mechanism access, as requested.
- **Exactly 2 A4 cardboard sheets total, both 3 mm thick**: the existing base + **1 extra A4 sheet for all 13 walls**. The supplied six-row nesting uses 10 mm outer margins, 2 mm horizontal gaps and 5 mm between rows. The furthest cut is x=199.423 mm, y=275 mm. Reuse the door/window cutouts as leaves, trimmed for clearance; no second wall stock thickness or additional cardboard is required. Tape and hardware are separate. Printed template pages are paper, not extra cardboard sheets.

## Doors, windows and electronics

The model has **9 doors and 11 windows**. All openings and leaf clearances are in `openings.csv`. Offsets are from each panel's west/north cut end, not its centre. Sill is height above the floor. Cutout width/height are exact; reuse the 3 mm wall cutout scraps as leaves and trim 1.5 mm from door width (0.75 mm per side) and 0.5 mm from door height. Window lift-out inserts subtract 0.5 mm from both width and height. D09 (shelter) hinges on its east/right edge; other doors hinge on the west/left or north/start edge as listed in the schedule. Window inserts lift out using tape pull-tabs; sliding rails are optional and require clearance checks with the real servo. Use face-mounted tape hinges on the inside of the wall, so the 3 mm door leaves sit proud of the wall face when closed and swing inward. Check the actual thickness and travel before gluing. Clear scrap plastic may replace window leaves, but is optional.

The planned controller is **SSTuino**, but the board is **not yet available**. The user has listed **servos, limit switches and buttons** for basic door/window interaction with the web app; physical fitting remains pending. Reserve **190 × 65 mm** on the unused A4 base for a removable control panel. This is a planning area, not a guarantee that unspecified components fit. Mounting holes, servo brackets, travel clearances, power and pin assignments remain pending actual parts and measurements. Do not cut hardware holes yet. Keep all hardware and leaf motion inside the A4 sheet. App fan, AC and purifier toggles are separate software controls; they do not require 11 additional physical switches.

## Fast assembly order

1. Print and verify the 50 mm bar, then glue the floor template to the A4 base without stretching it.
2. Measure stock thickness. Mark and cut wall rectangles, then the door and window holes. Label each panel W01–W13 on its underside.
3. Dry-fit the exterior rectangle; confirm 187.7 × 118.5 mm overall before gluing. Place all remaining walls over their printed footprints using the butt joints above.
4. Reinforce narrow door junctions with tape. Add tape-hinged door leaves and lift-out window inserts, checking full travel with furniture and walls in place.
5. Once the SSTuino is available, measure it and the buttons and servo assemblies before making the removable control panel. Route cables away from hinge travel; keep the model roofless.
6. Add optional paper furniture and labels only after the model and controls work. Demonstrate each physical input against the matching web-app state.

Written by gpt-6-astra in Codex on behalf of Edmund
'''
(ROOT/'docs/physical-model.md').write_text(md)
(OUT/'README.md').write_text(md.replace('../public/build-pack/','./'))
print(f'PASS: {W:.6f} × {D:.6f} mm footprint, {H:g} mm height; {len(walls)} panels, {counts["door"]} doors, {counts["window"]} windows')
print(f'Build pack: {OUT}')

# Check the cardboard geometry independently of the source's intersecting wall solids.
def plan_rect(p):
    a,b,t,c=p['start_mm'],p['end_mm'],p['thickness_mm'],p['center_mm']
    return (a,c-t/2,b,c+t/2) if p['axis']=='x' else (c-t/2,a,c+t/2,b)
def overlap(a,b):
    return min(a[2],b[2])-max(a[0],b[0]) > 1e-7 and min(a[3],b[3])-max(a[1],b[1]) > 1e-7
for i,p in enumerate(walls):
    r=plan_rect(p)
    assert -1e-7<=r[0]<=r[2]<=W+1e-7 and -1e-7<=r[1]<=r[3]<=D+1e-7
    for q in walls[:i]:
        assert not overlap(r,plan_rect(q)), (p['id'],q['id'])

def annotate_panel(s,p,x,y):
    ops=sorted((o for o in openings if o['wall_id']==p['id']),key=lambda o:o['offset_mm'])
    if not ops:
        return
    s.parts.append(f'<g class="measurement-annotations" data-panel="{p["id"]}">')
    spans=[]
    previous=0.0
    for i,o in enumerate(ops):
        left=o['offset_mm']
        gap=left-previous
        assert gap>=-1e-8
        spans.append((previous,left,'L' if i==0 else ''))
        px,py=x+left,y+H-o['sill_mm']-o['height_mm']
        s.text(px+o['width_mm']/2,py+o['height_mm']/2+3.2,f'L {left:.3f}',2.05,'middle')
        previous=left+o['width_mm']
    spans.append((previous,p['length_mm'],'R'))
    assert math.isclose(sum(b-a for a,b,_ in spans)+sum(o['width_mm'] for o in ops),p['length_mm'])
    for a,b,prefix in spans:
        midpoint=x+(a+b)/2
        label_x=max(x+5,min(x+p['length_mm']-5,midpoint))
        s.line(x+a,y+H+1.5,x+b,y+H+1.5,'#778787',.14)
        for edge in [a,b]:
            s.line(x+edge,y+H+.4,x+edge,y+H+2.1,'#778787',.14)
        if abs(label_x-midpoint)>.1:
            s.line(midpoint,y+H+1.5,label_x,y+H+2,'#778787',.14)
        s.text(label_x,y+H+4.1,f'{prefix} {b-a:.3f}'.strip(),2.05,'middle')
    s.parts.append('</g>')

def draw_panel(s,p,x,y):
    s.rect(x,y,p['length_mm'],H,fill='#fbfbf8',stroke='#17332e',sw=.2)
    s.text(x+1,y+3.2,f"{p['id']} {p['axis']} · {p['length_mm']:.2f} × 40",2.1,weight='bold')
    for o in [o for o in openings if o['wall_id']==p['id']]:
        px,py=x+o['offset_mm'],y+H-o['sill_mm']-o['height_mm']
        color='#a8552b' if o['kind']=='door' else '#2273a1'
        s.rect(px,py,o['width_mm'],o['height_mm'],fill='#fff',stroke=color,sw=.2)
        s.text(px+o['width_mm']/2,py+o['height_mm']/2,o['id'],2.4,'middle',weight='bold')
        if o['kind'] == 'door':
            hinge_x=px if o['hinge_side'] in ['west','north'] else px+o['width_mm']
            s.line(hinge_x,py+1,hinge_x,py+o['height_mm']-1,'#b3518d',.55)
    s.line(x,y+H+1,x+min(5,p['length_mm']),y+H+1,'#17332e',.25)
    annotate_panel(s,p,x,y)

# Nesting is physical stock allocation; print pages for schedules do not require more card.
stock_layouts = [
 ('all-walls-stock.svg','ALL WALLS / 3 mm card / one A4 sheet / no roof',[[0],[1],[4],[2,5,12],[3,8,10],[6,7,9,11]]),
]
stock_manifest=[]
for filename,title,rows in stock_layouts:
    s=SVG(title); s.text(10,5,title+' / dimensions in mm',2.5,weight='bold'); s.text(10,8.5,'x: viewed from south, left=west. z: viewed from west, left=north. L=left-edge offset; below=clear gaps; R=right gap. Grey lines are NOT cuts.',1.8)
    placed=[]
    for row,indices in enumerate(rows):
        x,y=10,10+row*45
        for idx in indices:
            p=walls[idx]
            draw_panel(s,p,x,y)
            rect=(x,y,x+p['length_mm'],y+H)
            assert rect[2]<=200 and rect[3]<=287
            assert all(not overlap(rect,a['rect_mm']) for a in placed)
            placed.append(dict(wall_id=p['id'],rect_mm=rect))
            x+=p['length_mm']+2
    assert len(placed)==13
    footer(s,annotation_clearance=True); s.save(OUT/filename)
    stock_manifest.append(dict(file=filename,placements=placed))
manifest['cardboard_sheets']=dict(total=2,existing_base_3mm=1,extra_all_walls_3mm=1,roof=False,horizontal_gap_mm=2,vertical_gap_mm=5,nesting=stock_manifest)
for obsolete in ['exterior-wall-stock.svg','interior-wall-stock.svg']:
    (OUT/obsolete).unlink(missing_ok=True)

opening_measurement_rows=[]
for page in range(4):
    s=SVG(f'Wall elevation templates {page+1} / 4')
    header(s,f'Wall elevations / {page+1} of 4','mm · L = panel LEFT edge to opening LEFT edge. Below panels: clear gaps; R = final right gap.')
    s.text(10,32,'x: viewed from south (west at left). z: viewed from west (north at left). Do not mirror. Grey lines are NOT cuts.',2.4)
    for row,p in enumerate(walls[page*4:(page+1)*4]):
        y=40+row*55
        s.text(10,y-3,p['name'].removeprefix('wall_').replace('_',' ')+f" / {p['thickness_mm']:g} mm card",2.7)
        draw_panel(s,p,10,y)
        s.text(10,y+H+9,f"Length {p['length_mm']:.4f} mm; mark {p['practical_length_mm']:.1f} mm. Height 40 mm.",2.3)
    if page==3:
        s.parts.append('<g class="measurement-annotations" data-schedule="opening-offsets">')
        s.text(10,101,'Opening measurements / existing cuts unchanged',3.6,weight='bold')
        s.text(10,108,'All mm, shown to 0.001 mm. L is from the panel left cut edge; gap is clear edge-to-edge.',2.5)
        s.text(10,113,'R is shown only for the final opening on each panel. Sill is measured up from panel bottom.',2.5)
        columns=[10,25,43,68,95,119,143,167]
        for cx,label in zip(columns,['ID','Wall','L offset','Gap before','Width','Height','Sill','R after']):
            s.text(cx,122,label,2.6,weight='bold')
        s.line(10,125,200,125,'#778787',.2)
        for row,o in enumerate(openings):
            p=by_wall[o['wall_name']]
            ops=sorted((a for a in openings if a['wall_id']==p['id']),key=lambda a:a['offset_mm'])
            i=ops.index(o)
            previous=ops[i-1]['offset_mm']+ops[i-1]['width_mm'] if i else 0
            values=[o['id'],p['id'],f"{o['offset_mm']:.3f}",f"{o['offset_mm']-previous:.3f}",f"{o['width_mm']:.3f}",f"{o['height_mm']:.3f}",f"{o['sill_mm']:.3f}",f"{p['length_mm']-o['offset_mm']-o['width_mm']:.3f}" if i==len(ops)-1 else '—']
            opening_measurement_rows.append(values)
            for cx,value in zip(columns,values):
                s.text(cx,131+row*6.5,value,2.65)
        s.text(10,267,'W10 / D07: L = 0.038 mm (nearly flush). Leader is enlarged for reading; the cut is unchanged.',2.4)
        s.parts.append('</g>')
    footer(s); s.save(OUT/f'wall-templates-{page+1}.svg')

s=SVG('Door and window leaf templates — reuse 3 mm wall cutouts')
header(s,'Movable leaves / tape hinges','Reuse 3 mm cutouts. Doors: trim 0.75 mm per side; windows: 0.25 mm. Top/bottom: 0.25 mm.')
for i,o in enumerate(openings):
    x,y=10+(i%4)*48,40+(i//4)*45
    s.text(x,y-3,f"{o['id']} / {o['wall_id']} / "+('hinge '+o['hinge_side'] if o['kind']=='door' else 'lift-out'),2.3,weight='bold')
    s.rect(x,y,o['leaf_width_mm'],o['leaf_height_mm'],stroke='#a8552b' if o['kind']=='door' else '#2273a1')
    if o['kind']=='door':
        hx=x if o['hinge_side'] in ['north','west'] else x+o['leaf_width_mm']
        s.line(hx,y,hx,y+o['leaf_height_mm'],'#b3518d',.6)
    s.text(x,y+o['leaf_height_mm']+4,f"{o['leaf_width_mm']:.2f} × {o['leaf_height_mm']:.2f}",2.2)
footer(s); s.save(OUT/'door-window-leaves.svg')

furniture=[]
devices=[]
for b in boxes:
    if b['type'] not in ['device','furniture']: continue
    item=dict(name=b['name'],width_mm=(b['max'][0]-b['min'][0])*MM,
              depth_mm=(b['max'][2]-b['min'][2])*MM,height_mm=(b['max'][1]-b['min'][1])*MM,
              center_x_mm=X((b['min'][0]+b['max'][0])/2),center_z_mm=Z((b['min'][2]+b['max'][2])/2),base_y_mm=b['min'][1]*MM)
    (devices if b['type']=='device' else furniture).append(item)
csv_file('optional-furniture.csv',furniture)
csv_file('devices.csv',devices)
controls=[]
for o in openings:
    controls.append(dict(label=o['id'],app_object=o['name'],category=o['kind'],wall=o['wall_id'],
                         control='open / closed',hardware_channel=o['hardware_channel'],physical='Planned SSTuino button / limit switch / servo channel; board not yet available; fitting and mapping pending',
                         hinge_side=o['hinge_side']))
for b in devices:
    if b['name']=='ac_condenser_yard': continue
    controls.append(dict(label=f"A{len(controls)-19:02}",app_object=b['name'],category='fan' if b['name'].startswith('fan_') else 'AC' if b['name'].startswith('ac_') else 'purifier',
                         wall='',control='on / off',hardware_channel='',physical='Web-app control; no physical switch required for the current build',hinge_side=''))
assert len(controls)==31 and len([c for c in controls if c['category'] in ['door','window']])==20
csv_file('control-map.csv',controls)
manifest.update(furniture=furniture,devices=devices,controls=controls)
(OUT/'dimensions.json').write_text(json.dumps(manifest,indent=2)+'\n')

md=md.replace('Keep all hardware and leaf motion inside the A4 sheet.', 'Use **lift-out window inserts with tape tabs** for the fastest build, or slide panels along the inner wall face after checking real mechanism clearance. Do not swing windows outward: west/east leaves would exceed the 11.15 mm A4 side margin. The digital scene uses sliding sashes. Mount door tape hinges on the inner wall face, not the centre line of thick card. Keep all hardware and leaf motion inside the A4 sheet; servo bodies and linkages need measured clearance, especially at the narrow kitchen/bedroom corners.')
md=md.replace('- [All wall dimensions CSV]', '- [All 13 walls on one A4 of 3 mm card — no roof](../public/build-pack/all-walls-stock.svg)\n- [Movable leaf templates](../public/build-pack/door-window-leaves.svg)\n- [Opening offset and gap measurements — SVG sheet 4](../public/build-pack/wall-templates-4.svg)\n- [Complete printable build pack](../public/build-pack/index.html)\n- [All wall dimensions CSV]')
md+='\n## Primary hardware channel labels\n\n| Channel | Opening | App object |\n|---|---|---|\n'+''.join(f"| {o['hardware_channel']} | {o['id']} | `{o['name']}` |\n" for o in openings if o['hardware_channel'])+'\nThese five channel names match `docs/04-hardware-protocol.md`. Other openings can stay manual for the MVP; no pin numbers or actual servo counts are assumed.\n'
md=md.replace('\nWritten by gpt-6-astra in Codex on behalf of Edmund\n','\n')
md+='\n## Supplementary schedules\n\n`control-map.csv` maps all 20 openings to exact application object names, and lists 11 separate app device toggles. `devices.csv` gives scale device envelopes/positions, not real hardware clearances. `optional-furniture.csv` gives 20 simplified furniture blocks; omit them until the mechanisms work. `rooms.csv` gives source room rectangles before the physical wall-thickness adjustment, not clear finished room sizes.\n'
md+='\nWritten by gpt-6-astra in Codex on behalf of Edmund\n'
(ROOT/'docs/physical-model.md').write_text(md)
(OUT/'README.md').write_text(md.replace('../public/build-pack/','./'))


def table(headers,rows):
    return '<div class="table-wrap"><table><thead><tr>'+''.join(f'<th>{html.escape(str(h))}</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join(f'<td>{html.escape(str(c))}</td>' for c in row)+'</tr>' for row in rows)+'</tbody></table></div>'

wall_table=table(['ID','Panel','Cut length × height','Card','Mark length'],[(p['id'],p['name'].removeprefix('wall_').replace('_',' '),f"{p['length_mm']:.3f} × 40",f"{p['thickness_mm']:g}",f"{p['practical_length_mm']:.1f}") for p in walls])
opening_table=table(['ID','Wall','L offset','Gap before','Width','Height','Sill','R after'],opening_measurement_rows)
room_table=table(['Room','Source rectangle in model','Real area'],[(r['name'].replace('_',' '),f"{r['width_mm']:.2f} × {r['depth_mm']:.2f} mm",f"{r['source_area_m2']:.2f} m²") for r in rooms])
links=[('heatsim-build-pack.zip','Download complete pack ZIP'),('floor-plan.svg','Floor plan · A4 1:1'),('all-walls-stock.svg','Annotated wall stock · A4'),('wall-templates-1.svg','Wall elevations 1 · W01–W04'),('wall-templates-2.svg','Wall elevations 2 · W05–W08'),('wall-templates-3.svg','Wall elevations 3 · W09–W12'),('wall-templates-4.svg','Opening measurements · sheet 4'),('door-window-leaves.svg','Door / window leaves'),('cut-list.csv','Wall dimensions CSV'),('openings.csv','Opening dimensions CSV'),('control-map.csv','Control map CSV'),('dimensions.json','All dimensions JSON'),('optional-furniture.csv','Optional furniture CSV'),('devices.csv','Device envelopes CSV'),('README.md','Builder notes')]
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HeatSim — physical build pack</title><style>
*{box-sizing:border-box}html{font-family:Arial,Helvetica,sans-serif;color:#17332e;background:#f1f3ed}body{margin:0}main{max-width:1160px;margin:auto;padding:48px 32px}a{color:#145b45}h1{font-size:clamp(32px,5vw,62px);letter-spacing:-2px;margin:10px 0 18px;line-height:1.02}h2{margin:0 0 16px;font-size:26px;letter-spacing:-.6px}h3{font-size:18px}.eyebrow{letter-spacing:2px;font-size:12px;font-weight:700}.lead{font-size:19px;line-height:1.5;max-width:760px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}.metric{background:#17332e;color:white;padding:22px}.metric strong{display:block;font-size:28px;margin-bottom:8px}.metric span{font-size:13px;color:#cdded5}.note{padding:20px;background:#fff5d9;border-left:4px solid #b47c2b;line-height:1.6}.downloads{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}.downloads a,button{border:1px solid #b4c6bb;background:white;padding:12px 15px;border-radius:4px;font:inherit;text-decoration:none;cursor:pointer}button{background:#174e3c;color:white;border-color:#174e3c;font-weight:700}section{margin-top:36px;background:#fff;padding:28px;break-inside:avoid}.sheet{width:210mm;max-width:100%;margin:auto;box-shadow:0 5px 24px #132a2212;background:white}.sheet svg{display:block;width:100%;height:auto}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.4}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#eaf0eb}th,td{padding:10px 9px;border-bottom:1px solid #e1e7e2}td:nth-child(n+3){font-variant-numeric:tabular-nums;white-space:nowrap}li{margin:8px 0;line-height:1.55}.small{font-size:13px;color:#546b60;line-height:1.6}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}.print-only{display:none}.template{margin-top:32px}footer{font-size:12px;color:#546b60;margin-top:28px} @media(max-width:700px){main{padding:24px 16px}.metrics{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}section{padding:18px}.metric strong{font-size:25px}}@page{size:A4;margin:0}@media print{html{background:white}main{padding:0;max-width:none}.screen-only{display:none}.print-only{display:block}.sheet{box-shadow:none;max-width:none;width:210mm;height:297mm;break-before:page;break-after:page;margin:0}.sheet:first-child{break-before:auto}.sheet.template{margin-top:0}.sheet svg{width:210mm;height:297mm}.print-notes{padding:12mm;break-before:page}section{margin:0;padding:12mm;background:white}table{font-size:10px}th,td{padding:6px}h2{font-size:20px}.table-wrap{overflow:visible}}
</style></head><body><main>'''
page+='''<div class="screen-only"><div class="eyebrow">HEATSIM / BUILDER HANDOFF / 1:65</div><h1>One flat.<br>Two sheets of cardboard.</h1><p class="lead">The complete physical model fits on your A4 base. Start with the floor plan, then cut all 13 walls from one extra sheet of 3 mm card. The layout follows the digital apartment, with butt joints and one doorway adjusted for the thicker physical card.</p><div class="metrics"><div class="metric"><strong>187.69 × 118.46 mm</strong><span>Outside building footprint · fits 200 × 150 mm</span></div><div class="metric"><strong>40 mm</strong><span>Wall height · 13 panels · 20 moving openings</span></div><div class="metric"><strong>1 extra A4 sheet</strong><span>Existing 3 mm base + 3 mm wall stock · no roof</span></div></div><div class="note"><strong>Print at 100% / Actual size.</strong> Disable “Fit to page” and browser headers/footers, and measure the 50 mm calibration bar. The two-sheet cardboard count is base + all walls, with no roof. Reuse the cutout scraps for moving leaves. Paper templates, tape and hardware are separate.</div><div class="downloads"><button onclick="window.print()">Print templates &amp; schedules</button>'''
page+=''.join(f'<a href="{name}" download>{label}</a>' for name,label in links)+'</div></div>'
page+='<div class="sheet">'+(OUT/'floor-plan.svg').read_text()+'</div>'
page+='''<section class="screen-only"><h2>Get the material right</h2><div class="grid2"><div><h3>Exactly 2 A4 sheets total</h3><ul><li><strong>1 existing A4 base</strong> — 210 × 297 mm. Use your existing 3 mm cardboard.</li><li><strong>1 extra A4 of 3 mm card</strong> — all 13 walls in six rows.</li><li><strong>No roof.</strong> Reuse wall cutouts for moving door/window leaves.</li></ul><p class="small">The nesting layout keeps 10 mm outer margins, 2 mm horizontal cut gaps and 5 mm between rows. No other cardboard thickness is required. Use tape hinges; optional furniture can use scraps.</p></div><div><h3>Check the real electronics first</h3><p class="small">SSTuino is planned but the board is not yet available. The user has listed servos, limit switches and buttons for door/window control; physical fitting is pending. A 190 × 65 mm removable electronics area is reserved on the A4 base. This is a space allowance, not a hardware mounting template.</p><p class="small"><strong>Do not cut servo, button or board holes before measuring the actual parts.</strong> Pins, channels, power and mounting dimensions are not defined by this mechanical pack. The app’s 11 fan/AC/purifier controls are software controls; they do not demand 11 extra physical switches.</p></div></div></section>'''
for filename,_,_ in stock_layouts:
    page+='<div class="sheet template">'+(OUT/filename).read_text()+'</div>'
page+='<div class="sheet template">'+(OUT/'door-window-leaves.svg').read_text()+'</div>'
page+='<section class="screen-only"><h2>Primary hardware labels</h2>'+table(['Channel','Opening','App object'],[(o['hardware_channel'],o['id'],o['name']) for o in openings if o['hardware_channel']])+'<p class="small">These channels follow docs/04-hardware-protocol.md; additional openings can remain manual. Servo mounting, pinout and power depend on the actual parts.</p></section>'
page+='<section class="print-notes"><h2>Wall schedule · all dimensions in mm</h2><p class="small">All walls are 40 mm tall. Exact cut lengths include butt-joint adjustments for 3 mm cardboard throughout. Mark to 0.1 mm, dry-fit and trim. Do not add card thickness to these lengths.</p>'+wall_table+'</section>'
page+='<section class="print-notes"><h2>Door and window schedule · all dimensions in mm</h2><p class="small">All values are mm, displayed to 0.001 mm. Viewed from south for x walls (west at left), or west for z walls (north at left). L is panel left cut edge to opening left cut edge. Gap before is the clear distance from the previous opening’s right edge (or panel left edge for the first opening). R is the final right-side remainder. Grey dimension lines are not cuts; all cut geometry is unchanged. Sill is measured up from the panel bottom. Reuse 3 mm cutouts: door leaves trim 1.5 mm in width and 0.5 mm in height; lift-out window inserts trim 0.5 mm in both. D02 is reduced to 11.577 mm clear width to avoid its thicker partition. D09 hinges on its east edge; other doors on the west/north edge. Windows lift out using tape pull-tabs. Magenta template marks indicate the hinge edge.</p>'+opening_table+'</section>'
page+='''<section class="print-notes"><h2>Assembly order</h2><ol><li>Verify the 50 mm bar, then glue the floor plan onto the existing A4 base without stretching.</li><li>Measure actual stock thickness. Cut and label W01–W13 using the single wall-stock nesting sheet; remove the door/window holes before assembly.</li><li>W01 and W02 span the full width. W03 and W04 butt between them. Confirm the outer rectangle is 187.69 × 118.46 mm before gluing.</li><li>Fit W05 between the exterior walls. W06–W08 butt between W01 and W05. W09 fits between W06 and W07. W10 fits between W05 and W02, W11 between W03 and W10, W12 starts at W10’s east face, and W13 butts below W12 and against W02.</li><li>D02 master-bedroom clear width is 11.577 mm after trimming its east edge to the partition face. Bedroom 2, bedroom 3 and kitchen junctions are effectively flush (0.038 mm theoretical clearance); reinforce them with tape.</li><li>Mount tape hinges on the inner wall face so reused 3 mm leaves sit proud of the wall when closed. <strong>Use lift-out window inserts with tape pull-tabs</strong>; optional sliding rails need a measured hardware fit. Outward-swinging windows exceed the A4 side margin. Check door swing and servo travel before adding furniture.</li><li>Build the removable electronics panel after measuring actual parts. Route wires away from moving leaves. Keep the model roofless for visibility and repair.</li><li>Label door/window controls with the matching D/G identifiers. Test one physical input at a time against the app. Add optional furniture only after the controls work.</li></ol><div class="note">Approximate educational model, not an official HDB drawing. These are scale geometry dimensions, not real servo/switch footprints. Hardware holes and pin assignments remain pending actual components.</div></section>'''
page+='<section class="screen-only"><h2>Room reference dimensions</h2><p class="small">Source room rectangles before adjusting physical card thickness. These are not finished clear internal room dimensions.</p>'+room_table+'</section>'
page+='<footer class="screen-only">Written by gpt-6-astra in Codex on behalf of Edmund</footer></main></body></html>'
(OUT/'index.html').write_text(page)
print('PASS: no wall overlaps; 2 A4 sheets total, all 3 mm, no roof; stock nesting checked; 20 opening mappings + 11 app controls')

with zipfile.ZipFile(OUT/'heatsim-build-pack.zip','w',zipfile.ZIP_DEFLATED) as bundle:
    for path in sorted(OUT.iterdir()):
        if path.is_file() and path.suffix!='.zip':
            entry = zipfile.ZipInfo(path.name,date_time=(1980,1,1,0,0,0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry,path.read_bytes())
print('Shareable ZIP generated: heatsim-build-pack.zip')
