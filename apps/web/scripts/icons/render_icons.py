"""Renders Wasit's 3D icon set with Blender (Cycles), one transparent WebP per icon.

Run `pnpm --filter @wasit/web render:icons` with Blender 4.2+ on PATH, which calls:
  blender -b --factory-startup -P scripts/icons/render_icons.py -- <out_dir> [name ...]
Every icon is built from primitives in code, so the set stays consistent and reproducible.
The coin symbols need a font with U+20BF (₿): Segoe UI Bold on Windows, or set ICON_FONT.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(ARGS[0] if ARGS else "icons-out")
ONLY = set(ARGS[1:])
SIZE = 256  # shown at up to 128 CSS px, so 2x for high-density screens
SYMBOL_FONT = os.environ.get("ICON_FONT", "C:/Windows/Fonts/segoeuib.ttf")

PALETTE = {
    "btc": "#f7931a",
    "gold": "#f2b84b",
    "silver": "#c9d0da",
    "paper": "#ffffff",
    "line": "#cdd5e0",
    "navy": "#16304f",
    "green": "#22c55e",
    "dollar": "#12a46a",
    "blue": "#3b82f6",
    "amber": "#f5b031",
    "white": "#ffffff",
}


def srgb(hex_color):
    """Hex sRGB to the linear RGBA Blender expects."""
    h = hex_color.lstrip("#")
    channels = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (*lin, 1.0)


_materials = {}


def material(name, color, metallic=0.0, roughness=0.35, coat=0.0):
    key = (name, color, metallic, roughness, coat)
    if key in _materials:
        return _materials[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(PALETTE.get(color, color))
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    _materials[key] = mat
    return mat


# Finishes shared by every icon so the set reads as one family
def glossy(color):
    return material(f"glossy-{color}", color, roughness=0.32, coat=0.6)


def metal(color):
    return material(f"metal-{color}", color, metallic=1.0, roughness=0.26)


def matte(color):
    return material(f"matte-{color}", color, roughness=0.55)


# --- scene -----------------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(os.environ.get("ICON_SAMPLES", "160"))
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.quality = 92
    # Standard keeps the palette saturated (AgX turns it pastel); exposure keeps it from clipping
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.35

    # Studio sky: bright top, soft horizon, dark floor, so metal has something to reflect
    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.18, 0.19, 0.22, 1)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (1.0, 0.98, 0.95, 1)
    map_range = nodes.new("ShaderNodeMapRange")
    map_range.inputs["From Min"].default_value = -1
    links.new(coords.outputs["Generated"], sep.inputs[0])
    links.new(sep.outputs["Z"], map_range.inputs["Value"])
    links.new(map_range.outputs["Result"], ramp.inputs["Fac"])
    background = nodes["Background"]
    background.inputs["Strength"].default_value = 0.9
    links.new(ramp.outputs["Color"], background.inputs["Color"])

    add_light("key", (-3.5, -4.5, 6.5), 1100, 5.0, "#fff4e6")
    add_light("fill", (5.5, -2.5, 2.5), 300, 4.0, "#e6eeff")
    add_light("rim", (1.5, 5.5, 4.5), 600, 3.0, "#ffffff")
    return scene


def add_light(name, location, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = srgb(color)[:3]
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0, 0, 0.6)) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def smooth(obj, bevel=0.0, segments=5):
    if obj.type == "MESH":
        obj.data.shade_smooth()
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.harden_normals = True
    return obj


def link_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


# --- primitives ------------------------------------------------------------------------------


def box(size, location, mat, bevel=0.06, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return link_material(smooth(obj, bevel), mat)


def cylinder(radius, depth, location, mat, rotation=(0, 0, 0), bevel=0.04, vertices=128):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return link_material(smooth(bpy.context.object, bevel), mat)


def tube(points, radius, mat, cyclic=False):
    """A round tube through `points` (poly spline, smoothed by many points)."""
    curve = bpy.data.curves.new("tube", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 8
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new("tube", curve)
    bpy.context.scene.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def slab(outline, depth, mat, bevel=0.03, location=(0, 0, 0), rotation=(0, 0, 0)):
    """Extrudes a closed 2D outline (x, z pairs, in the plane facing the camera)."""
    curve = bpy.data.curves.new("slab", "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = depth / 2
    curve.bevel_depth = bevel
    curve.bevel_resolution = 4
    spline = curve.splines.new("POLY")
    spline.points.add(len(outline) - 1)
    for point, (x, y) in zip(spline.points, outline):
        point.co = (x, y, 0, 1)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new("slab", curve)
    bpy.context.scene.collection.objects.link(obj)
    curve.materials.append(mat)
    obj.location = location
    obj.rotation_euler = (math.radians(90) + rotation[0], rotation[1], rotation[2])
    return obj


def glyph(text, size, depth, mat, location, rotation=(0, 0, 0)):
    curve = bpy.data.curves.new("glyph", "FONT")
    curve.body = text
    curve.font = bpy.data.fonts.load(SYMBOL_FONT, check_existing=True)
    curve.size = size
    curve.extrude = depth / 2
    curve.bevel_depth = depth / 4
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    obj = bpy.data.objects.new("glyph", curve)
    bpy.context.scene.collection.objects.link(obj)
    curve.materials.append(mat)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def coin(radius, location, rotation, face, symbol=None, symbol_mat=None, finish=metal):
    """A coin with a raised rim; when standing, its face points toward the camera (-y)."""
    depth = radius * 0.22
    body = cylinder(radius, depth, (0, 0, 0), finish(face), bevel=depth * 0.3)
    rim_mat = finish(face)
    parts = [body]
    for side in (1, -1):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=radius * 0.86,
            minor_radius=depth * 0.12,
            location=(0, 0, side * depth / 2),
            major_segments=128,
            minor_segments=16,
        )
        ring = link_material(smooth(bpy.context.object), rim_mat)
        parts.append(ring)
    if symbol:
        mark = glyph(symbol, radius * 1.3, depth * 0.35, symbol_mat, (0, 0, depth / 2))
        parts.append(mark)
    holder = bpy.data.objects.new("coin", None)
    bpy.context.scene.collection.objects.link(holder)
    for part in parts:
        part.parent = holder
    holder.location = location
    holder.rotation_euler = rotation
    return holder


def check_mark(center, scale, mat, plane_y):
    cx, cz = center
    pts = [(-0.42, -0.02), (-0.12, -0.32), (0.45, 0.3)]
    return tube([(cx + x * scale, plane_y, cz + z * scale) for x, z in pts], scale * 0.11, mat)


def document(width=1.5, height=1.95, lean=-8):
    """Sheet with text lines, leaning back from its bottom edge. Returns the pivot: objects built
    in upright coordinates and given to `attach` lean with the sheet."""
    pivot = bpy.data.objects.new("document", None)
    bpy.context.scene.collection.objects.link(pivot)
    attach(pivot, box((width, 0.08, height), (0, 0, height / 2 + 0.02), glossy("paper"), bevel=0.05))
    lines = [(0.78, 0.55, "gold"), (0.5, 0.95, "line"), (0.3, 0.95, "line"), (0.1, 0.7, "line")]
    for z_frac, w_frac, color in lines:
        z = height * (0.5 + z_frac * 0.5)
        x = -(1 - w_frac) * width * 0.28
        attach(pivot, box((width * w_frac * 0.75, 0.03, 0.09), (x, -0.05, z), matte(color), bevel=0.04))
    pivot.rotation_euler = (math.radians(lean), 0, 0)
    return pivot


def attach(pivot, obj):
    obj.parent = pivot
    return obj


def circle_points(radius, start_deg, end_deg, count, y=0.0, center=(0, 0)):
    return [
        (
            center[0] + radius * math.cos(math.radians(a)),
            y,
            center[1] + radius * math.sin(math.radians(a)),
        )
        for a in (start_deg + (end_deg - start_deg) * i / (count - 1) for i in range(count))
    ]


def cone_at(tip_base, direction, radius, length, mat):
    direction = Vector(direction).normalized()
    location = Vector(tip_base) + direction * (length / 2)
    bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=radius, radius2=0, depth=length, location=location)
    cone = bpy.context.object
    cone.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return link_material(smooth(cone, 0.02, 3), mat)


# --- icons -----------------------------------------------------------------------------------


def icon_coins_btc():
    for i, (dx, dy) in enumerate([(0.0, 0.0), (0.05, -0.04), (-0.04, 0.03)]):
        coin(0.72, (-0.42 + dx, 0.25 + dy, 0.09 + i * 0.17), (0, 0, 0), "silver")
    coin(0.78, (0.55, -0.5, 0.8), (math.radians(78), 0, math.radians(-18)), "btc", "₿", glossy("white"), finish=glossy)


def icon_btc_coin():
    coin(0.95, (0, 0, 0.98), (math.radians(80), 0, math.radians(-14)), "btc", "₿", glossy("white"), finish=glossy)


def icon_dollar_coin():
    coin(0.95, (0, 0, 0.98), (math.radians(80), 0, math.radians(-14)), "dollar", "$", glossy("white"), finish=glossy)


def icon_doc_check():
    document()
    cylinder(0.44, 0.16, (0.62, -0.35, 0.5), glossy("green"), rotation=(math.radians(90), 0, 0), bevel=0.05)
    check_mark((0.62, 0.5), 0.55, glossy("white"), -0.47)


def icon_contract():
    sheet = document()
    star = []
    for i in range(48):
        a = math.radians(i * 360 / 48)
        r = 0.42 if i % 2 == 0 else 0.37
        star.append((0.6 + r * math.cos(a), 0.5 + r * math.sin(a)))
    slab(star, 0.14, glossy("gold"), bevel=0.02, location=(0, -0.3, 0))
    cylinder(0.24, 0.06, (0.6, -0.4, 0.5), glossy("btc"), rotation=(math.radians(90), 0, 0), bevel=0.02)
    sign = [(-0.55 + 0.9 * t, -0.07, 0.55 + 0.08 * math.sin(t * 14) * (1 - t)) for t in (i / 40 for i in range(41))]
    attach(sheet, tube(sign, 0.025, matte("navy")))


def icon_swap():
    plane_y, z0 = 0.0, 1.0
    arcs = [(25, 155, "blue"), (205, 335, "btc")]
    for start, end, color in arcs:
        mat = glossy(color)
        pts = circle_points(0.82, start, end, 48, plane_y, (0, z0))
        tube(pts, 0.13, mat)
        tip = Vector(pts[-1])
        tangent = (tip - Vector(pts[-2])).normalized()
        cone_at(tip, tangent, 0.3, 0.42, mat)


def icon_padlock():
    pts = [(-0.42, 0.0, 0.95), (-0.42, 0.0, 1.35)]
    pts += circle_points(0.42, 180, 0, 40, 0.0, (0, 1.35))[1:-1]
    pts += [(0.42, 0.0, 1.35), (0.42, 0.0, 0.95)]
    tube(pts, 0.12, metal("silver"))
    box((1.45, 0.62, 1.05), (0, 0, 0.56), glossy("gold"), bevel=0.16)
    cylinder(0.13, 0.08, (0, -0.31, 0.68), matte("navy"), rotation=(math.radians(90), 0, 0), bevel=0.02)
    box((0.1, 0.06, 0.3), (0, -0.31, 0.47), matte("navy"), bevel=0.03)


def shield_outline(scale=1.0):
    right = []
    for i in range(41):
        t = i / 40
        if t < 0.45:
            x, z = 0.82, 1.0 - t * 1.1  # straight side
        else:
            u = (t - 0.45) / 0.55  # curve into the point
            x, z = 0.82 * (1 - u**1.6), 0.505 - u * 1.42 + 0.12 * math.sin(math.pi * u)
        right.append((x, z))
    top = [(-0.82 + 1.64 * i / 20, 1.0 + 0.08 * math.sin(math.pi * i / 20)) for i in range(1, 20)]
    left = [(-x, z) for x, z in reversed(right)]
    pts = [(0.82, 1.0)] + right[1:] + left[1:] + top[::-1][::-1]
    return [(x * scale, z * scale + 1.05) for x, z in pts]


def icon_shield():
    slab(shield_outline(1.0), 0.2, glossy("gold"), bevel=0.04, location=(0, 0.06, 0))
    slab(shield_outline(0.84), 0.2, glossy("navy"), bevel=0.04, location=(0, -0.06, 0))
    check_mark((0.0, 1.05), 0.75, glossy("green"), -0.26)


def icon_alert():
    outline = []
    for k in range(3):
        a = math.radians(90 + k * 120)
        outline.append((0.95 * math.cos(a), 0.95 + 0.95 * math.sin(a)))
    slab(outline, 0.24, glossy("amber"), bevel=0.14)
    box((0.12, 0.1, 0.48), (0, -0.3, 1.02), matte("navy"), bevel=0.05)
    cylinder(0.08, 0.1, (0, -0.3, 0.6), matte("navy"), rotation=(math.radians(90), 0, 0), bevel=0.02)


# Flat, front-facing icons turn toward the camera so they do not read as skewed
TURN = {"doc-check": 20, "contract": 20, "shield": 24, "alert": 24, "swap": 24, "padlock": 12}

ICONS = {
    "coins-btc": icon_coins_btc,
    "btc-coin": icon_btc_coin,
    "dollar-coin": icon_dollar_coin,
    "doc-check": icon_doc_check,
    "contract": icon_contract,
    "swap": icon_swap,
    "padlock": icon_padlock,
    "shield": icon_shield,
    "alert": icon_alert,
}


# --- camera ----------------------------------------------------------------------------------


def frame_camera(scene):
    """Orthographic camera from front-right-above, fitted to the icon's geometry."""
    cam_data = bpy.data.cameras.new("camera")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.rotation_euler = (math.radians(68), 0, math.radians(28))
    bpy.context.view_layer.update()
    forward = cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    cam.location = -forward * 20
    bpy.context.view_layer.update()

    depsgraph = bpy.context.evaluated_depsgraph_get()
    to_cam = cam.matrix_world.inverted()
    xs, ys = [], []
    for obj in scene.objects:
        if obj.type not in {"MESH", "CURVE", "FONT"}:
            continue
        # Exact extent from the evaluated geometry (curve bound boxes are loose)
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            p = to_cam @ (evaluated.matrix_world @ vertex.co)
            xs.append(p.x)
            ys.append(p.y)
        evaluated.to_mesh_clear()
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cam.location = cam.matrix_world @ Vector((cx, cy, 0))
    cam_data.ortho_scale = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.16


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, build in ICONS.items():
        if ONLY and name not in ONLY:
            continue
        scene = reset_scene()
        build()
        root = bpy.data.objects.new("root", None)
        scene.collection.objects.link(root)
        for obj in list(scene.objects):
            if obj.parent is None and obj.type not in {"LIGHT", "CAMERA"} and obj is not root:
                obj.parent = root
        root.rotation_euler = (0, 0, math.radians(TURN.get(name, 0)))
        bpy.context.view_layer.update()
        frame_camera(scene)
        scene.render.filepath = os.path.join(OUT_DIR, f"{name}.webp")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {name}")


main()
