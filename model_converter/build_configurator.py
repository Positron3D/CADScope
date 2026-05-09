#!/usr/bin/env python3
# ABOUTME: Builds CADScope sidecar (and Prusawire manifest) outputs from a GLB and an optional spec.
# ABOUTME: When no sibling .spec.yaml exists, falls back to scaffold-only mode (legacy dump_parts.py behavior).
"""
Build sidecar/manifest outputs from a GLB.

Three modes:

  Scaffold mode (default when no <model>.spec.yaml is present) writes:
    <model>.scaffold.json   — always-overwritten reference dump of the GLB tree.
    <model>.colors.json     — starter live config; only written if absent.

  Full mode (when <model>.spec.yaml exists) additionally writes:
    <model>.colors.json     — generated CADScope sidecar (palette/autoAssign/nodes).
    <model>.manifest.json   — generated Prusawire manifest (options/parts/stl).

  Check mode (--check) is read-only: parses + validates the spec, walks the GLB,
  and prints an autoAssign coverage report. Writes nothing.

Usage:
    python build_configurator.py model.glb                    # auto-detect mode
    python build_configurator.py model.glb -o custom.json     # override base output path
    python build_configurator.py --scaffold-only model.glb    # force scaffold mode
    python build_configurator.py --check model.glb            # validate + coverage report
"""

import json
import os
import re
import sys
from fnmatch import fnmatchcase

from glb import read_glb_json, extract_names, build_node_paths


def starter_live_config():
    """A clean template for a fresh .colors.json — no part assignments."""
    return {
        "palette": {
            "Main":               {"color": "#FF6600"},
            "Accent":             {"color": "#00AAFF"},
            "Extrusions":         {"color": "#888888", "metalness": 0.8, "showInPicker": False},
            "Opaque Panels":      {"color": "#333333", "showInPicker": False},
            "Transparent Panels": {"color": "#555555", "showInPicker": False},
            "Glass":              {"color": "#ccddee", "metalness": 0.1, "opacity": 0.15, "showInPicker": False},
        },
        "autoAssign": [],
        "nodes": {},
    }


def derive_paths(glb_path, base_override):
    """Compute live-config and scaffold output paths from a GLB path."""
    live_path = base_override
    if not live_path:
        live_path = re.sub(r"\.glb$", ".colors.json", glb_path, flags=re.IGNORECASE)

    scaffold_path = re.sub(r"\.colors\.json$", ".scaffold.json", live_path, flags=re.IGNORECASE)
    if scaffold_path == live_path:
        scaffold_path = re.sub(r"\.json$", ".scaffold.json", live_path, flags=re.IGNORECASE)
    if scaffold_path == live_path:
        scaffold_path = live_path + ".scaffold.json"

    return live_path, scaffold_path


def emit_starter_colors(live_path):
    """Write a starter colors.json if one does not already exist at the path."""
    if os.path.exists(live_path):
        print(f"Live config already exists, leaving alone: {live_path}")
        return False
    with open(live_path, "w") as f:
        json.dump(starter_live_config(), f, indent=2)
        f.write("\n")
    print(f"Wrote starter live config: {live_path}")
    return True


def emit_scaffold(glb_json, scaffold_path):
    """Write the always-overwritten reference dump of the GLB tree."""
    group_names, mesh_names = extract_names(glb_json)
    node_pairs = build_node_paths(glb_json)
    scaffold = {
        "_groups": group_names,
        "_parts": mesh_names,
        "_nodes": {path: name for path, name in node_pairs},
    }
    with open(scaffold_path, "w") as f:
        json.dump(scaffold, f, indent=2)
        f.write("\n")
    return len(group_names), len(mesh_names), len(node_pairs)


def derive_spec_path(glb_path, base_override):
    """Locate the sibling .spec.yaml for a given GLB or output-base path."""
    if base_override:
        stem = re.sub(r"\.colors\.json$", "", base_override, flags=re.IGNORECASE)
        if stem == base_override:
            stem = re.sub(r"\.json$", "", base_override, flags=re.IGNORECASE)
        return stem + ".spec.yaml"
    return re.sub(r"\.glb$", ".spec.yaml", glb_path, flags=re.IGNORECASE)


def derive_manifest_path(live_path):
    """Locate the manifest output beside the colors.json output."""
    out = re.sub(r"\.colors\.json$", ".manifest.json", live_path, flags=re.IGNORECASE)
    if out == live_path:
        out = re.sub(r"\.json$", ".manifest.json", live_path, flags=re.IGNORECASE)
    if out == live_path:
        out = live_path + ".manifest.json"
    return out


def write_json(obj, path):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def build_colors_json(spec):
    """Generate the CADScope sidecar dict from a parsed Spec.

    Includes a node entry only when the node carries persistent metadata:
    a displayName, an explicit category override, or default-hidden visibility.
    Anything visible by default and lacking metadata is left to autoAssign.
    """
    from spec import default_config, evaluate_visible

    cfg = default_config(spec)
    nodes_out = {}
    for path, node in spec.nodes.items():
        entry = {}
        if node.display_name:
            entry["displayName"] = node.display_name
        if node.category:
            entry["category"] = node.category
        if not evaluate_visible(node, cfg):
            entry["hidden"] = True
        if entry:
            nodes_out[path] = entry
    return {
        "palette": dict(spec.palette),
        "autoAssign": list(spec.auto_assign),
        "nodes": nodes_out,
    }


def build_manifest_json(spec, glb_node_paths=None):
    """Generate the Prusawire manifest dict from a parsed Spec.

    A part entry is emitted for every node with a visibility rule or an
    STL download path. Top-level rules are expanded into synthetic part
    entries for matching GLB paths not already declared in nodes:.
    """
    parts = []
    declared = set(spec.nodes.keys())

    for path, node in spec.nodes.items():
        has_visibility = (
            node.visible_when is not None
            or node.visible_unless is not None
            or node.hidden
        )
        has_stl = node.stl is not None
        if not has_visibility and not has_stl:
            continue
        part = {"id": path, "nodes": [path]}
        visible = {}
        if node.visible_when:
            visible["when"] = dict(node.visible_when)
        if node.visible_unless:
            visible["unless"] = dict(node.visible_unless)
        if visible:
            part["visible"] = visible
        if node.hidden:
            part["hidden"] = True
        if node.stl is not None:
            part["stl"] = list(node.stl)
        if node.visual_only:
            part["visualOnly"] = True
        parts.append(part)

    if glb_node_paths:
        for rule in spec.rules:
            for key in ("hide", "show"):
                if key not in rule:
                    continue
                pat = rule[key]
                clause = rule.get("when") or {}
                clause_key = "unless" if key == "hide" else "when"
                for p in glb_node_paths:
                    if not (
                        fnmatchcase(p, pat)
                        or fnmatchcase(p.split("/")[-1], pat)
                    ):
                        continue
                    if p in declared:
                        continue
                    declared.add(p)
                    parts.append({
                        "id": p,
                        "nodes": [p],
                        "visible": {clause_key: dict(clause)},
                    })

    out = {
        "version": "2.0.0",
        "glb": spec.glb_path,
        "configOptions": dict(spec.options),
        "parts": parts,
    }
    if spec.compatibility:
        out["compatibility"] = list(spec.compatibility)
    if spec.stl_base is not None:
        out["stlBase"] = spec.stl_base
    return out


def parse_args(argv):
    args = list(argv[1:])
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        sys.exit(0)

    scaffold_only = False
    if "--scaffold-only" in args:
        args.remove("--scaffold-only")
        scaffold_only = True

    check_only = False
    if "--check" in args:
        args.remove("--check")
        check_only = True

    output_base = None
    if "-o" in args:
        idx = args.index("-o")
        if idx + 1 >= len(args):
            print("Error: -o requires a path argument", file=sys.stderr)
            sys.exit(2)
        output_base = args[idx + 1]
        args = args[:idx] + args[idx + 2:]

    if not args:
        print("Error: missing GLB path", file=sys.stderr)
        sys.exit(2)

    return args[0], output_base, scaffold_only, check_only


def format_check_report(spec, spec_path, glb_path, glb_paths, validator_warnings, coverage):
    """Render a coverage report as plain text. Used by --check mode."""
    lines = []
    lines.append(f"spec:    {spec_path} — VALID")
    lines.append(f"glb:     {glb_path} ({coverage.total_nodes} nodes)")
    lines.append("")

    cat_names = ", ".join(spec.palette.keys())
    lines.append(f"palette: {len(spec.palette)} categories ({cat_names})")

    if spec.auto_assign:
        lines.append(f"autoAssign: {len(spec.auto_assign)} rules")
        max_cat = max(len(r["category"]) for r in spec.auto_assign)
        max_pat = max(len(r["match"]) for r in spec.auto_assign)
        for i, rule in enumerate(spec.auto_assign):
            cat = rule["category"].ljust(max_cat)
            pat = rule["match"].ljust(max_pat)
            count = coverage.rule_counts[i]
            warn = "  (zero-match)" if count == 0 else ""
            lines.append(f"  [{cat}] {pat} → {count:>5} nodes{warn}")
    else:
        lines.append("autoAssign: (none)")

    lines.append("")
    direct = coverage.covered_via_autoAssign + coverage.covered_via_overrides
    direct_pct = direct * 100 // max(coverage.total_nodes, 1)
    eff_pct = coverage.effective_covered * 100 // max(coverage.total_nodes, 1)
    lines.append(
        f"direct:    {coverage.covered_via_autoAssign} via autoAssign + "
        f"{coverage.covered_via_overrides} per-node overrides "
        f"= {direct}/{coverage.total_nodes} ({direct_pct}%)")
    lines.append(
        f"effective: {coverage.effective_covered}/{coverage.total_nodes} ({eff_pct}%)  "
        "(direct + cascade inheritance from a matched ancestor)")
    if coverage.truly_uncovered:
        lines.append(
            f"truly uncovered: {coverage.truly_uncovered}  "
            "(neither the node nor any ancestor matched)")

    if coverage.truly_uncovered_sample:
        lines.append("")
        lines.append(
            f"truly-uncovered sample (first {len(coverage.truly_uncovered_sample)}, in tree order):")
        for path in coverage.truly_uncovered_sample:
            lines.append(f"  {path}")

    lines.append("")
    lines.append(f"per-node entries:    {len(spec.nodes)}")
    lines.append(f"visibility rules:    {len(spec.rules)}")

    if validator_warnings:
        lines.append("")
        lines.append("warnings:")
        for w in validator_warnings:
            lines.append(f"  {w}")

    return "\n".join(lines)


def main():
    glb_path, output_base, scaffold_only, check_only = parse_args(sys.argv)

    if not os.path.isfile(glb_path):
        print(f"Error: file not found: {glb_path}", file=sys.stderr)
        return 1

    live_path, scaffold_path = derive_paths(glb_path, output_base)
    glb_json = read_glb_json(glb_path)
    spec_path = derive_spec_path(glb_path, output_base)
    has_spec = os.path.isfile(spec_path)

    if check_only:
        if not has_spec:
            print(f"Error: --check requires a sibling .spec.yaml at {spec_path}",
                  file=sys.stderr)
            return 1
        from spec import parse_file, SpecError, validate_against_tree, compute_coverage
        try:
            s = parse_file(spec_path)
        except SpecError as e:
            print(f"spec:    {spec_path} — INVALID")
            print(f"  {e}")
            return 1
        glb_paths = [p for p, _ in build_node_paths(glb_json)]
        warnings = validate_against_tree(s, glb_paths)
        coverage = compute_coverage(s, glb_paths)
        print(format_check_report(s, spec_path, glb_path, glb_paths, warnings, coverage))
        return 0

    n_groups, n_parts, n_nodes = emit_scaffold(glb_json, scaffold_path)
    print(f"Wrote scaffold ({n_groups} groups, {n_parts} parts, {n_nodes} nodes): {scaffold_path}")

    if scaffold_only or not has_spec:
        emit_starter_colors(live_path)
        if not has_spec:
            print('Copy paths from _nodes into the live "nodes" map; copy names from _groups/_parts as autoAssign glob inputs.')
        return 0

    from spec import parse_file, validate_against_tree

    s = parse_file(spec_path)

    glb_paths = [p for p, _ in build_node_paths(glb_json)]
    for w in validate_against_tree(s, glb_paths):
        print(f"warning: {w}", file=sys.stderr)

    write_json(build_colors_json(s), live_path)
    print(f"Wrote sidecar: {live_path}")

    manifest_path = derive_manifest_path(live_path)
    write_json(build_manifest_json(s, glb_node_paths=glb_paths), manifest_path)
    print(f"Wrote manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
