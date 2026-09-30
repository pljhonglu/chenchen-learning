import json, pathlib

path = pathlib.Path("poems.js")
text = path.read_text(encoding="utf-8")
body = text[text.index("=")+1:].strip()
if body.endswith(";"):
    body = body[:-1]
poems = json.loads(body)
new_lines = [
    ("仙人垂两足", [("仙", "xiān"), ("人", "rén"), ("垂", "chuí"), ("两", "liǎng"), ("足", "zú")]),
    ("桂树何团团", [("桂", "guì"), ("树", "shù"), ("何", "hé"), ("团", "tuán"), ("团", "tuán")]),
    ("白兔捣药成", [("白", "bái"), ("兔", "tù"), ("捣", "dǎo"), ("药", "yào"), ("成", "chéng")]),
    ("问言与谁餐", [("问", "wèn"), ("言", "yán"), ("与", "yǔ"), ("谁", "shuí"), ("餐", "cān")]),
]
for p in poems:
    if p.get("title") == "古朗月行":
        new_texts = {t for t, _ in new_lines}
        keep = [ln for ln in p["lines"] if ln.get("text") not in new_texts]
        p["lines"] = keep[:4]
        for text_line, chars in new_lines:
            p["lines"].append({"text": text_line, "chars": [{"c": c, "p": py} for c, py in chars]})
        p["note"] = "节选「小时不识月」至「问言与谁餐」八句。"
        print("patched", [ln["text"] for ln in p["lines"]])
        assert len(p["lines"]) == 8
        assert [c["p"] for c in p["lines"][5]["chars"]] == ["guì", "shù", "hé", "tuán", "tuán"]
        assert p["lines"][7]["chars"][2]["p"] == "yǔ"
        assert p["lines"][7]["chars"][4]["p"] == "cān"
        break
else:
    raise SystemExit("poem not found")
compact = text.lstrip().startswith("const POEMS = [")
if compact:
    out = "const POEMS = " + json.dumps(poems, ensure_ascii=False, separators=(",", ":")) + ";\n"
else:
    out = "const POEMS = " + json.dumps(poems, ensure_ascii=False, indent=2) + ";\n"
path.write_text(out, encoding="utf-8")
print("wrote", path.stat().st_size)
