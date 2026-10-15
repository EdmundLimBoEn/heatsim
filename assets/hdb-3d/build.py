import json, numpy as np, trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual import TextureVisuals
H=2.6; T_EXT=0.2; T_INT=0.1
scene=trimesh.Scene(); boxes=[]; MATS={}
def mat(rgb):
    k=tuple(rgb)
    if k not in MATS: MATS[k]=PBRMaterial(baseColorFactor=[*rgb,255],metallicFactor=0,roughnessFactor=0.8)
    return MATS[k]
def add(name,typ,size,local_off,origin,rgb,extra=None,box=True):
    """size: (sx,sy,sz); local_off: box centre relative to node origin; origin: node world pos"""
    m=trimesh.creation.box(extents=size); m.apply_translation(local_off)
    m.visual=TextureVisuals(material=mat(rgb))
    Tm=np.eye(4); Tm[:3,3]=origin
    scene.add_geometry(m,node_name=name,geom_name=name,transform=Tm)
    if box:
        c=np.array(origin)+np.array(local_off); s=np.array(size)/2
        b={"name":name,"type":typ,"min":list(np.round(c-s,3)),"max":list(np.round(c+s,3))}
        if extra: b.update(extra)
        boxes.append(b)
def add_mesh(name,typ,m,origin,rgb):
    m.visual=TextureVisuals(material=mat(rgb)); Tm=np.eye(4); Tm[:3,3]=origin
    scene.add_geometry(m,node_name=name,geom_name=name,transform=Tm)
    bb=m.bounds+np.array(origin)
    boxes.append({"name":name,"type":typ,"min":list(np.round(bb[0],3)),"max":list(np.round(bb[1],3))})
# ---- rooms (x east, z south, y up), plan 12 x 7.5 m
rooms={"master_bedroom":(0,0,3.8,3.4),"master_bath":(3.8,0,5.6,2.0),"common_bath":(3.8,2.0,5.6,3.4),
"bedroom2":(5.6,0,8.8,3.4),"bedroom3":(8.8,0,12,3.4),"kitchen":(0,3.4,2.8,5.6),"service_yard":(0,5.6,2.8,7.5),
"household_shelter":(2.8,5.9,4.4,7.5),"corridor":(2.8,3.4,12,4.4),"corridor_lobby":(2.8,4.4,4.4,5.9),
"dining":(4.4,4.4,7.2,7.5),"living":(7.2,4.4,12,7.5)}
floorcol={"master_bath":(170,200,210),"common_bath":(170,200,210),"kitchen":(200,190,170),"service_yard":(180,180,180),"household_shelter":(150,150,150)}
roomlist=[]
for n,(x0,z0,x1,z1) in rooms.items():
    add("floor_"+n,"floor",(x1-x0,0.05,z1-z0),(0,-0.025,0),((x0+x1)/2,0,(z0+z1)/2),floorcol.get(n,(205,175,135)))
    roomlist.append({"name":n,"min":[x0,0,z0],"max":[x1,H,z1],"area_m2":round((x1-x0)*(z1-z0),2)})
    boxes.append({"name":"room_"+n,"type":"room","min":[x0,0,z0],"max":[x1,H,z1]})
# ceiling (single mesh, not in boxes as solid; listed as type floor-like 'ceiling')
add("ceiling","ceiling",(12,0.05,7.5),(0,0.025,0),(6,H,3.75),(240,240,240),{"boundary":"wall","thermal":"adiabatic","note":"ceiling slab: solid no-slip adiabatic; viewer opacity does not affect it"})
# ---- walls with openings: (name, axis, fixed, a0, a1, thick, openings[(name,kind,centre,width,sill,height,hinge)])
D=lambda n,c,w=0.8,hinge="min": (n,"door",c,w,0.0,2.1,hinge)
W=lambda n,c,w=1.2,sill=0.9,h=1.2,hinge="min": (n,"window",c,w,sill,h,hinge)
walls=[
("wall_ext_north","x",0,0,12,T_EXT,[W("window_master_1",1.9,1.6),W("window_bedroom2_1",7.2,1.4),W("window_bedroom3_1",10.4,1.4),W("window_master_bath",4.7,0.6,1.5,0.6)]),
("wall_ext_south","x",7.5,0,12,T_EXT,[W("window_service_yard",1.4,1.4),D("main_door",5.4,0.9),W("window_living_1",8.6,1.6,0.5,1.7),W("window_living_2",10.8,1.6,0.5,1.7)]),
("wall_ext_west","z",0,0,7.5,T_EXT,[W("window_master_2",1.7,1.2),W("window_kitchen",4.5,1.2,1.0,1.0)]),
("wall_ext_east","z",12,0,7.5,T_EXT,[W("window_bedroom3_2",1.7,1.0),W("window_living_3",5.9,1.2,0.5,1.7)]),
("wall_north_corridor","x",3.4,0,12,T_INT,[D("door_master_bedroom",3.35),D("door_common_bath",4.7,0.7),D("door_bedroom2",6.1),D("door_bedroom3",9.3)]),
("wall_masterbath_commonbath","x",2.0,3.8,5.6,T_INT,[]),
("wall_master_masterbath","z",3.8,0,3.4,T_INT,[D("door_master_bath",1.0,0.7)]),
("wall_bath_bedroom2","z",5.6,0,3.4,T_INT,[]),
("wall_bedroom2_bedroom3","z",8.8,0,3.4,T_INT,[]),
("wall_kitchen_corridor","z",2.8,3.4,7.5,T_INT,[D("door_kitchen",3.9)]),
("wall_kitchen_yard","x",5.6,0,2.8,T_INT,[D("door_service_yard",1.4)]),
("wall_shelter_north","x",5.9,2.8,4.4,T_INT,[D("door_shelter",3.6,0.8,"max")]),
("wall_shelter_east","z",4.4,5.9,7.5,T_INT,[]),
]
WALLC=(235,230,220); n_seg=0
def wallbox(name,axis,fixed,a0,a1,y0,y1,t):
    if a1-a0<1e-3 or y1-y0<1e-3: return
    if axis=="x": add(name,"wall",(a1-a0,y1-y0,t),(0,0,0),((a0+a1)/2,(y0+y1)/2,fixed),WALLC)
    else: add(name,"wall",(t,y1-y0,a1-a0),(0,0,0),(fixed,(y0+y1)/2,(a0+a1)/2),WALLC)
for wn,axis,fx,a0,a1,t,ops in walls:
    ops=sorted(ops,key=lambda o:o[2]); cur=a0; k=0
    for (on,kind,c,w,sill,h,hinge) in ops:
        s,e=c-w/2,c+w/2
        wallbox(f"{wn}_{k}",axis,fx,cur,s,0,H,t); k+=1
        if sill>0: wallbox(f"{wn}_{k}",axis,fx,s,e,0,sill,t); k+=1
        wallbox(f"{wn}_{k}",axis,fx,s,e,sill+h,H,t); k+=1
        cur=e
        # leaf: origin at hinge edge (bottom of opening), leaf extends along +/- wall axis
        th=0.04 if kind=="door" else 0.02
        sgn=1 if hinge=="min" else -1; ha=s if hinge=="min" else e
        col=(120,80,50) if kind=="door" else (150,200,230)
        if on=="main_door": col=(90,50,30)
        if axis=="x": size=(w,h,th); off=(sgn*w/2,h/2,0); org=(ha,sill,fx)
        else: size=(th,h,w); off=(0,h/2,sgn*w/2); org=(fx,sill,ha)
        ext=wn.startswith("wall_ext_")
        add(on,kind,size,off,org,col,{"wall":wn,"exterior":ext,"boundary_closed":"wall","boundary_when_open":"opening_to_outside" if ext else "internal_opening","openable":True,"hinge_axis":"y","hinge_point":[round(v,3) for v in org],"opening_min_max_along_wall":[s,e],"wall_axis":axis})
    wallbox(f"{wn}_{k}",axis,fx,cur,a1,0,H,t)
# ---- furniture: origin at base centre
def F(name,size,pos,rgb,typ="furniture"):
    add(name,typ,size,(0,size[1]/2,0),(pos[0],0 if len(pos)==2 else pos[2],pos[1]),rgb)
F("sofa",(2.2,0.85,0.9),(9.6,4.95),(60,90,140)); F("coffee_table",(1.0,0.45,0.55),(9.6,5.9),(140,100,60))
F("tv_console",(1.8,0.5,0.4),(9.6,7.2),(80,60,40)); F("dining_table",(1.4,0.75,0.8),(5.8,5.9),(160,120,80))
for i,(dx,dz) in enumerate([(-0.4,-0.6),(0.4,-0.6),(-0.4,0.6),(0.4,0.6)]): F(f"dining_chair_{i+1}",(0.45,0.9,0.45),(5.8+dx,5.9+dz),(110,80,50))
F("bed_master_queen",(1.55,0.5,2.05),(1.9,1.25),(200,80,80)); F("wardrobe_master",(1.8,2.2,0.6),(1.5,3.05),(150,120,90))
F("bed_bedroom2_single",(1.0,0.5,1.95),(6.3,1.2),(80,160,90)); F("wardrobe_bedroom2",(1.2,2.2,0.6),(8.1,0.4),(150,120,90))
F("study_desk_bedroom2",(1.2,0.75,0.6),(7.9,3.0),(170,140,100))
F("bed_bedroom3_single",(1.0,0.5,1.95),(11.3,1.2),(200,170,60)); F("wardrobe_bedroom3",(1.2,2.2,0.6),(9.6,0.4),(150,120,90))
F("study_desk_bedroom3",(1.2,0.75,0.6),(9.6,3.0),(170,140,100))
F("kitchen_counter_1",(0.6,0.9,2.2),(0.4,4.5),(190,190,195)); F("kitchen_counter_2",(1.8,0.9,0.6),(1.6,3.8),(190,190,195))
F("fridge",(0.7,1.8,0.7),(2.35,5.15),(230,230,235)); F("washing_machine",(0.6,0.85,0.6),(0.45,7.0),(245,245,250))
# devices
def fan(name,x,z):
    m=trimesh.creation.cylinder(radius=0.6,height=0.05,sections=12); m.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2,[1,0,0]))
    rod=trimesh.creation.cylinder(radius=0.03,height=0.35,sections=6); rod.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2,[1,0,0])); rod.apply_translation((0,0.2,0))
    g=trimesh.util.concatenate([m,rod]); g.apply_translation((0,0.025,0))
    add_mesh(name,"device",g,(x,H-0.4,z),(90,90,90))  # origin at blade base centre
fan("fan_living",9.6,5.95); fan("fan_dining",5.8,5.9); fan("fan_master",1.9,1.6); fan("fan_bedroom2",7.2,1.7); fan("fan_bedroom3",10.4,1.7)
# wall ACs (0.9 x 0.3 x 0.22), base centre, mounted ~2.1-2.4 m
F("ac_living",(0.22,0.3,0.9),(11.85,5.9,2.15),(250,250,250),"device")
F("ac_master",(0.22,0.3,0.9),(0.15,1.0,2.15),(250,250,250),"device"); boxes[-1]
F("ac_bedroom2",(0.9,0.3,0.22),(7.2,3.29,2.15),(250,250,250),"device")
F("ac_bedroom3",(0.9,0.3,0.22),(10.4,3.29,2.15),(250,250,250),"device")
F("ac_condenser_yard",(0.85,0.65,0.35),(2.2,7.2),(200,200,190),"device")
F("purifier_living",(0.3,0.6,0.3),(7.6,4.75),(200,240,255),"device")
F("purifier_master",(0.3,0.6,0.3),(3.4,0.4),(200,240,255),"device")
# ---- sim flags: rooms are fluid, everything else is solid
for b in boxes:
    b["sim_solid"]=b["type"]!="room"
    b.setdefault("boundary","fluid" if b["type"]=="room" else "wall")
# export, then post-process with pygltflib: extras, ceiling/exterior-wall materials, parent groups
scene.export("hdb_4room.glb")
import pygltflib
g=pygltflib.GLTF2().load("hdb_4room.glb"); btype={b["name"]:b["type"] for b in boxes}
def newmat(name,rgba,blend):
    m=pygltflib.Material(name=name,doubleSided=blend,alphaMode="BLEND" if blend else "OPAQUE",
      pbrMetallicRoughness=pygltflib.PbrMetallicRoughness(baseColorFactor=rgba,metallicFactor=0,roughnessFactor=0.8))
    g.materials.append(m); return len(g.materials)-1
m_ceil=newmat("ceiling_material",[0.94,0.94,0.94,0.25],True)
m_ext=newmat("exterior_wall_material",[0.92,0.9,0.86,1.0],False)
ceil_nodes=[];ext_nodes=[]
for i,n in enumerate(g.nodes):
    if n.mesh is None or n.name not in btype: continue
    role=btype[n.name]; n.extras={"role":role,"sim_solid":True}
    if role in("door","window"): n.extras.update(state="closed",exterior=n.name in [b["name"] for b in boxes if b.get("exterior")])
    if n.name=="ceiling":
        ceil_nodes.append(i)
        for p in g.meshes[n.mesh].primitives: p.material=m_ceil
    elif n.name.startswith("wall_ext_"):
        ext_nodes.append(i); n.extras["exterior"]=True
        for p in g.meshes[n.mesh].primitives: p.material=m_ext
root=g.scenes[g.scene or 0]; rootnode=g.nodes[root.nodes[0]] if len(root.nodes)==1 and g.nodes[root.nodes[0]].children else None
for grp,kids in (("ceiling_group",ceil_nodes),("exterior_walls_group",ext_nodes)):
    g.nodes.append(pygltflib.Node(name=grp,children=kids,extras={"role":"group","contains":grp[:-6]})); gi=len(g.nodes)-1
    for n in g.nodes[:-1]:
        if n.children: n.children=[c for c in n.children if c not in kids]
    root.nodes=[c for c in root.nodes if c not in kids]
    (rootnode.children if rootnode else root.nodes).append(gi)
g.asset.extras={"sim_note":"Visual only. Opacity/visibility here never affects the simulation; the sim reads hdb_4room_boxes.json."}
g.save("hdb_4room.glb")
allmin=np.min([b["min"] for b in boxes],0); allmax=np.max([b["max"] for b in boxes],0)
total=sum(r["area_m2"] for r in roomlist)
json.dump({"sim_metadata":{"source_of_truth":"This JSON is the ONLY geometry input to the CFD/heat/haze sim.",
  "decoupling":"Visual opacity, x-ray, cutaway, clipping and visibility in the viewer/GLB have NO effect on the simulation. The ceiling is always a solid no-slip adiabatic wall here.",
  "sim_solid":"true = solid cell (walls, floor, ceiling, closed doors/windows, furniture, devices); false = fluid (room air volumes)",
  "boundary":"wall | fluid; doors/windows also carry boundary_closed and boundary_when_open (opening_to_outside for exterior, internal_opening otherwise)"},
 "units":"metres","up":"+Y","plan":"x=east(0..12), z=south(0..7.5), floor at y=0","ceiling_height":H,
 "bounds":{"min":list(map(float,allmin)),"max":list(map(float,allmax))},"total_floor_area_m2":round(total,2),
 "rooms":roomlist,"boxes":boxes},open("hdb_4room_boxes.json","w"),indent=1,default=float)
print("total",total,"nodes",len(scene.graph.nodes_geometry))
# preview
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt; from matplotlib.patches import Rectangle
fig,ax=plt.subplots(figsize=(14,9)); cm={"wall":"#444","door":"#a0522d","window":"#3fa9f5","furniture":"#d9a066","device":"#e0306a"}
for r in roomlist: ax.add_patch(Rectangle((r["min"][0],r["min"][2]),r["max"][0]-r["min"][0],r["max"][2]-r["min"][2],fc="#f6efe0",ec="#bbb"))
for b in boxes:
    if b["type"] in cm and b["name"]!="ceiling":
        ax.add_patch(Rectangle((b["min"][0],b["min"][2]),max(b["max"][0]-b["min"][0],.03),max(b["max"][2]-b["min"][2],.03),fc=cm[b["type"]],alpha=.8 if b["type"]!="device" else .6))
for r in roomlist: ax.text((r["min"][0]+r["max"][0])/2,(r["min"][2]+r["max"][2])/2,f'{r["name"]}\n{r["area_m2"]} m²',ha="center",va="center",fontsize=8,weight="bold")
ax.set_xlim(-.5,12.5); ax.set_ylim(8,-.5); ax.set_aspect("equal"); ax.set_xlabel("x (m, east)"); ax.set_ylabel("z (m, south)")
ax.set_title(f"Approximate HDB 4-room flat (not official) – top view, total {total:.1f} m²\nbrown=doors, blue=windows, tan=furniture, pink=devices (fans/AC/purifiers)")
plt.savefig("preview.png",dpi=110,bbox_inches="tight")
