import json
import os

# Paths
script_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(script_dir, "payload_vinhthanh.json")
output_path = os.path.join(script_dir, "insert_vinhthanh.sql")

with open(json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

elements = data["elements"]

wards = []       # type == "unit"
orgs = []         # type == "dept"
persons = []      # type == "alias"

for el in elements:
    t = el["type"]
    if t == "unit":
        wards.append(el)
    elif t == "dept":
        orgs.append(el)
    elif t == "alias":
        persons.append(el)

def esc(s):
    """Escape single quotes for SQL"""
    return s.replace("'", "''")

lines = []
lines.append("-- ============================================")
lines.append("-- INSERT data from payload_vinhthanh.json")
lines.append("-- Generated automatically")
lines.append("-- ============================================")
lines.append("")

# Ward inserts (unit)
lines.append("-- === WARD (unit) ===")
# Sort: parent=0 first so root inserts before children
wards.sort(key=lambda x: x["parent"])
for w in wards:
    parent_id = "NULL" if w["parent"] == 0 else str(w["parent"])
    lines.append(
        f"INSERT INTO \"ward\" (\"id\", \"parent_id\", \"name\", \"type\") "
        f"VALUES ({w['id']}, {parent_id}, '{esc(w['name'])}', '{esc(w['type'])}');"
    )

lines.append("")

# Organizational inserts (dept)
lines.append("-- === ORGANIZATIONAL (dept) ===")
orgs.sort(key=lambda x: x["id"])
for o in orgs:
    lines.append(
        f"INSERT INTO \"organizational\" (\"id\", \"parent_id\", \"name\", \"type\") "
        f"VALUES ({o['id']}, {o['parent']}, '{esc(o['name'])}', '{esc(o['type'])}');"
    )

lines.append("")

# Person inserts (alias)
lines.append("-- === PERSON (alias) ===")
persons.sort(key=lambda x: x["id"])
for p in persons:
    lines.append(
        f"INSERT INTO \"person\" (\"id\", \"parent_id\", \"name\", \"refUname\", \"refFullname\", \"type\", \"rank\") "
        f"VALUES ({p['id']}, {p['parent']}, '{esc(p['name'])}', '{esc(p['refUname'])}', '{esc(p['refFullname'])}', '{esc(p['type'])}', '{esc(p['rank'])}');"
    )

output = "\n".join(lines) + "\n"

with open(output_path, "w", encoding="utf-8") as f:
    f.write(output)

print(f"Done! Generated {len(wards)} ward + {len(orgs)} organizational + {len(persons)} person records")
print(f"Output: {output_path}")
